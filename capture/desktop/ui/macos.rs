use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::Arc;

use gpui::{AnyElement, App, Div, Window};
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, NSObjectProtocol, Sel};
use objc2::{AnyThread, DefinedClass, MainThreadOnly, msg_send, sel};
use objc2_app_kit::{
    NSAppearanceCustomization, NSApplication, NSCellImagePosition, NSColor, NSImage, NSMenu,
    NSMenuDelegate, NSMenuItem,
    NSStatusBar, NSStatusItem, NSStatusWindowLevel, NSWindow, NSWindowButton,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{MainThreadMarker, NSArray, NSData, NSObject, NSSize, NSString};
use screencapturekit::prelude::*;
use screencapturekit::screenshot_manager::{CGImageExt, SCScreenshotManager};

use super::super::{LaserOverlay, MenuAction};
use crate::capture::engine::runtime::SharedCaptureTelemetry;

/// Where the file browser is called in buttons ("Show in Finder").
pub(in crate::capture::desktop) const FILE_MANAGER: &str = "Finder";
/// The review header's leading inset, clear of the traffic lights.
pub(in crate::capture::desktop) const HEADER_LEAD: f32 = 78.0;
pub(in crate::capture::desktop) const HEADER_TRAIL: f32 = 16.0;
/// The pill's top edge, just below the 37 pt menu bar.

/// Global coordinates are points, as GPUI lays out.
pub(in crate::capture::desktop) fn points_per_pixel(_window: &Window) -> f32 {
    1.0
}

/// The GPUI display that is the screen at `frame` (global points), else the primary one.
pub(in crate::capture::desktop) fn display_at(
    frame: [f32; 4],
    cx: &App,
) -> Option<std::rc::Rc<dyn gpui::PlatformDisplay>> {
    let screens = crate::capture::engine::runtime::screens::displays();
    let id = crate::capture::engine::runtime::screens::index_for_rect(&screens, frame.map(f64::from)).map(|i| screens[i].id);
    id.and_then(|id| cx.displays().into_iter().find(|d| u32::from(d.id()) == id))
        .or_else(|| cx.primary_display())
}

/// A window covering the screen at `frame` lays out at its size: global coordinates are points.
pub(in crate::capture::desktop) fn layout_size(
    frame: [f32; 4],
    _display: Option<&dyn gpui::PlatformDisplay>,
) -> gpui::Size<gpui::Pixels> {
    gpui::size(gpui::px(frame[2]), gpui::px(frame[3]))
}

/// Moves a window to cover the screen at `frame` (global points).
fn move_window_to_screen(ns_win: &NSWindow, frame: [f64; 4]) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(primary_h) = objc2_app_kit::NSScreen::screens(mtm)
        .firstObject()
        .map(|s| s.frame().size.height)
    else {
        return;
    };
    let [x, y, w, h] = crate::capture::engine::runtime::screens::flip(frame, primary_h);
    ns_win.setFrame_display(
        objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(x, y),
            objc2_foundation::NSSize::new(w, h),
        ),
        true,
    );
}

/// Moves the open picker to cover the screen at `frame` (global points).
pub(in crate::capture::desktop) fn move_picker_window(frame: [f64; 4], _cx: &mut App) {
    if let Some(ns_win) = find_picker_ns_window() {
        move_window_to_screen(&ns_win, frame);
    }
}

/// GPUI places windows relative to their display on macOS.
pub(in crate::capture::desktop) fn window_origin(_display: Option<&dyn gpui::PlatformDisplay>) -> gpui::Point<gpui::Pixels> {
    gpui::Point::default()
}

pub(in crate::capture::desktop) fn window_drag_region(region: Div) -> Div {
    use gpui::{InteractiveElement, MouseButton};
    region.on_mouse_down(MouseButton::Left, |_, window, _| {
        window.start_window_move();
    })
}

/// A control inside a `window_drag_region` gets its clicks as it is.
pub(in crate::capture::desktop) fn drag_region_control<E>(control: E) -> E {
    control
}

/// AppKit opens the menu itself (refreshed in menuNeedsUpdate:).
pub(in crate::capture::desktop) fn poll_status_bar() {}

/// The traffic lights are native; nothing to draw.
pub(in crate::capture::desktop) fn caption_buttons() -> Option<AnyElement> {
    None
}

/// Window levels keep the pill above the picker above the overlay.

/// `apparent lab`'s backdrop (`w` × `h` points): borderless, under the capsule, letting clicks through.
pub(in crate::capture::desktop) fn configure_lab_backdrop(w: f32, h: f32) {
    if let Some(mtm) = MainThreadMarker::new() {
        for win in NSApplication::sharedApplication(mtm).windows() {
            let f = win.frame().size;
            if (f.width - f64::from(w)).abs() < 1.0 && (f.height - f64::from(h)).abs() < 1.0 {
                win.setStyleMask(NSWindowStyleMask::Borderless);
                configure_floating_window(&win, true, 4);
            }
        }
    }
}

/// AppKit keeps an accessory app running without windows. Info.plist's `LSUIElement` starts
/// Apparent as one with no Dock icon, but gpui 0.2.2 sets the regular activation policy once
/// launched, so this puts it back (`stay_out_of_dock`).
pub(in crate::capture::desktop) fn keep_alive(_cx: &mut App) {
    stay_out_of_dock();
    if let Some(mtm) = MainThreadMarker::new() {
        let app = NSApplication::sharedApplication(mtm);
        let delegate: Option<Retained<AnyObject>> = unsafe { msg_send![&*app, delegate] };
        if !delegate.as_ref().is_some_and(|delegate| install_quit_guard(delegate.class())) {
            crate::capture::engine::runtime::apparent_log(
                "Native quit guard not installed: unexpected GPUI application delegate",
            );
        }
    }
}

// GPUI 0.2.2 registers GPUIApplicationDelegate (an NSResponder subclass) without
// applicationShouldTerminate:. Add only that missing method, not a replacement
// delegate: GPUI's platform ivar and every existing handler must remain intact.
// Refuse a foreign delegate or a future GPUI implementation rather than replacing
// an unknown IMP/ABI. Its existing applicationWillTerminate: still owns shutdown.
fn install_quit_guard(class: &AnyClass) -> bool {
    let Some(expected) = AnyClass::get(c"GPUIApplicationDelegate") else { return false };
    if !std::ptr::eq(class, expected) { return false; }
    let selector = sel!(applicationShouldTerminate:);
    if let Some(method) = class.instance_method(selector) {
        return method.implementation() as *const () == application_should_terminate as *const ();
    }
    unsafe extern "C" {
        fn class_addMethod(class: &AnyClass, selector: Sel, imp: Imp, types: *const std::ffi::c_char) -> Bool;
    }
    // NSApplicationTerminateReply is NSUInteger (Q on supported 64-bit Macs).
    // Main-thread installation precedes capture admission; no method is replaced.
    unsafe {
        class_addMethod(
            class, selector,
            std::mem::transmute::<unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize, Imp>(application_should_terminate),
            c"Q@:@".as_ptr(),
        ).as_bool()
    }
}

unsafe extern "C-unwind" fn application_should_terminate(
    _delegate: &AnyObject, _selector: Sel, _application: &AnyObject,
) -> usize {
    use crate::capture::desktop::workflow::shutdown;
    if shutdown::busy() {
        shutdown::request();
        0 // NSTerminateCancel; the GUI performs normal Stop and drains finalizers.
    } else {
        1 // NSTerminateNow, AppKit's default when this optional method is absent.
    }
}

/// Keeps Apparent a menu bar app with no Dock icon.
fn stay_out_of_dock() {
    use objc2_app_kit::NSApplicationActivationPolicy;
    if let Some(mtm) = MainThreadMarker::new() {
        NSApplication::sharedApplication(mtm)
            .setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    }
}

/// AppKit gives every window the app's icon.
pub(in crate::capture::desktop) fn decorate_app_window(_window: &mut Window) {}

/// The app that was in front when Apparent activated itself for the picker or the review window
/// (0: none).
static PREVIOUS_FRONT_APP: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

/// Called just before Apparent activates itself to take the keys. Apparent in front already (one
/// key window opening over another) keeps the app remembered first.
fn remember_front_app() {
    use objc2_app_kit::NSWorkspace;
    let front = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map_or(0, |app| app.processIdentifier());
    if front > 0 && front != std::process::id() as i32 {
        PREVIOUS_FRONT_APP.store(front, std::sync::atomic::Ordering::Release);
    }
}

/// A menu bar (accessory) app isn't active when its menu or capsule is used, and keys only
/// reach its windows while it is: remember the app in front, then activate ignoring other apps
/// (the cooperative `NSApp.activate()` may leave the window behind the app in front).
pub(in crate::capture::desktop) fn take_keys(cx: &mut App) {
    remember_front_app();
    cx.activate(true);
}

/// A normal titled AppKit window is already movable and resizable.

/// Run (deferred) after any window closes: once neither a picker nor a review window is left,
/// the app that was in front before gets the keys back. `NSApp.deactivate()` isn't enough: a
/// menu bar (accessory) app stays frontmost with no windows, and keys go nowhere. Deferred, a
/// picker replacing another one is open again by the time this looks.
pub(in crate::capture::desktop) fn hand_back_keys(cx: &mut App) {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    if cx.windows().iter().any(|handle| {
        handle.downcast::<super::super::TargetPickerWindow>().is_some()
            || handle.downcast::<super::super::BundleReviewWindow>().is_some()
    }) {
        return;
    }
    let previous = PREVIOUS_FRONT_APP.swap(0, std::sync::atomic::Ordering::AcqRel);
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    if !app.isActive() {
        return;
    }
    let reactivated = previous > 0
        && NSRunningApplication::runningApplicationWithProcessIdentifier(previous)
            .is_some_and(|prev| prev.activateWithOptions(NSApplicationActivationOptions::empty()));
    if !reactivated {
        app.deactivate();
    }
}

pub(in crate::capture::desktop) fn start_updates() {
    crate::capture::desktop::sparkle::start();
}

pub(in crate::capture::desktop) fn check_for_updates() {
    crate::capture::desktop::sparkle::check_for_updates();
}

pub(in crate::capture::desktop) fn open_overlay(
    telemetry: Arc<SharedCaptureTelemetry>,
    on: Option<[f64; 4]>,
    _cx: &mut gpui::Context<super::super::ApparentCoordinator>,
) -> Result<LaserOverlay, String> {
    LaserOverlay::open(telemetry, on)
}

/// The picker: borderless at status level + 1 over the whole screen at `frame` (global points,
/// menu bar included), taking clicks (`apparent lab` replays let them through). Returns its window
/// number, to leave out of the recording.
pub(in crate::capture::desktop) fn configure_picker_window(
    _window: &mut Window,
    lab: bool,
    frame: [f64; 4],
    _cx: &mut App,
) -> Option<u32> {
    let ns_win = find_picker_ns_window()?;
    ns_win.setStyleMask(NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel);
    configure_floating_window(&ns_win, lab, 1);
    move_window_to_screen(&ns_win, frame);
    // gpui made it key before the style change above; make it key again so it takes the keys
    // once Apparent is active (`take_keys`).
    if !lab {
        ns_win.makeKeyAndOrderFront(None);
    }
    let num = ns_win.windowNumber().max(0) as u32;
    (num > 0).then_some(num)
}

pub(in crate::capture::desktop) fn picker_window_number() -> Option<u32> {
    let num = find_picker_ns_window()?.windowNumber().max(0) as u32;
    (num > 0).then_some(num)
}

pub(in crate::capture::desktop) fn front_own_window() -> Option<isize> {
    let mtm = MainThreadMarker::new()?;
    let app = NSApplication::sharedApplication(mtm);
    app.windows()
        .iter()
        .filter(|w| {
            let size = w.frame().size;
            size.width >= 600.0 && size.height >= 400.0
        })
        .max_by_key(|w| {
            let size = w.frame().size;
            (size.width as i64) * (size.height as i64)
        })
        .map(|w| {
            w.orderFrontRegardless();
            w.windowNumber()
        })
}
/// Whether macOS asks for reduced motion (Accessibility ▸ Display ▸ Reduce motion).
pub(in crate::capture::desktop) fn reduce_motion() -> bool {
    use objc2::runtime::AnyClass;
    let Some(cls) = AnyClass::get(c"NSWorkspace") else {
        return false;
    };
    unsafe {
        let workspace: *mut AnyObject = msg_send![cls, sharedWorkspace];
        !workspace.is_null() && msg_send![workspace, accessibilityDisplayShouldReduceMotion]
    }
}

struct MenuTargetIvars {
    sender: flume::Sender<MenuAction>,
}

objc2::define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = MenuTargetIvars]
    struct ApparentMenuTarget;

    unsafe impl NSObjectProtocol for ApparentMenuTarget {}

    impl ApparentMenuTarget {
        #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
        fn menu_bar_appearance_changed(
            &self,
            _key_path: &NSString,
            _object: &AnyObject,
            _change: &AnyObject,
            _context: *mut std::ffi::c_void,
        ) {
            STATUS_BAR.with(|slot| {
                if let Some(controller) = slot.borrow().as_ref() {
                    refresh_status_bar_icon(&controller._item, self.mtm());
                }
            });
        }

        #[unsafe(method(toggleCapture:))]
        fn toggle_capture(&self, _sender: &AnyObject) {
            let _ = self.ivars().sender.try_send(MenuAction::ToggleCapture);
        }

        #[unsafe(method(chooseTarget:))]
        fn choose_target(&self, _sender: &AnyObject) {
            let _ = self.ivars().sender.try_send(MenuAction::ChooseTarget);
        }

        #[unsafe(method(toggleMicrophone:))]
        fn toggle_microphone(&self, _sender: &AnyObject) { let _ = self.ivars().sender.try_send(MenuAction::ToggleMicrophone); }

        #[unsafe(method(openLatest:))]
        fn open_latest(&self, _sender: &AnyObject) {
            let _ = self.ivars().sender.try_send(MenuAction::OpenLatest);
        }

        #[unsafe(method(exportVideo:))]
        fn export_video(&self, _sender: &AnyObject) {
            let _ = self.ivars().sender.try_send(MenuAction::ExportVideo);
        }

        #[unsafe(method(openSettings:))]
        fn open_settings(&self, _sender: &AnyObject) {
            let _ = self.ivars().sender.try_send(MenuAction::Settings);
        }

        #[unsafe(method(checkForUpdates:))]
        fn check_for_updates(&self, _sender: &AnyObject) {
            let _ = self.ivars().sender.try_send(MenuAction::CheckForUpdates);
        }

        #[unsafe(method(quitApp:))]
        fn quit_app(&self, _sender: &AnyObject) {
            let _ = self.ivars().sender.try_send(MenuAction::Quit);
        }

        #[unsafe(method(openInboxItem:))]
        fn open_inbox_item(&self, sender: &NSMenuItem) {
            let path = sender
                .representedObject()
                .and_then(|object| object.downcast::<NSString>().ok())
                .map(|path| PathBuf::from(path.to_string()));
            if let Some(path) = path {
                let _ = self.ivars().sender.try_send(MenuAction::OpenInbox(path));
            }
        }
    }

    unsafe impl NSMenuDelegate for ApparentMenuTarget {
        #[unsafe(method(menuNeedsUpdate:))]
        fn menu_needs_update(&self, menu: &NSMenu) {
            rebuild_inbox_menu_items(menu, self);
            if let Some(item) = menu.itemWithTag(MICROPHONE_MENU_TAG) { item.setState(if crate::capture::engine::runtime::audio::mic::enabled() { 1 } else { 0 }); }
            if let Some(item) = menu.itemWithTag(RECORD_MENU_TAG) {
                item.setTitle(&NSString::from_str(&record_menu_title()));
            }
            if let Some(item) = menu.itemWithTag(EXPORT_VIDEO_MENU_TAG) {
                item.setHidden(!crate::shared::handoff::video_export());
            }
        }
    }
);

/// Tag on the status menu's inbox rows, so each open can replace them.
const INBOX_MENU_TAG: isize = 0x5c4a;
/// Tag on **Export Last Capture as Video…**, shown only with `"videoExport": true`.
const EXPORT_VIDEO_MENU_TAG: isize = 0x5c4e;
/// Tag on **Record Screen**, whose title carries the record shortcut.
const RECORD_MENU_TAG: isize = 0x5c4d;
const MICROPHONE_MENU_TAG: isize = 0x5c50;

/// "Record Screen" with the record shortcut as it is now (Settings can change it).
fn record_menu_title() -> String {
    format!(
        "Record Screen  {}",
        crate::capture::desktop::settings::Shortcuts::load().record.label
    )
}

/// Lists unhandled iPhone captures at the top of the status menu, read fresh from disk so the
/// ages are current.
fn rebuild_inbox_menu_items(menu: &NSMenu, target: &ApparentMenuTarget) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    for index in (0..menu.numberOfItems()).rev() {
        if menu
            .itemAtIndex(index)
            .is_some_and(|item| item.tag() == INBOX_MENU_TAG)
        {
            menu.removeItemAtIndex(index);
        }
    }
    let inbox = crate::capture::desktop::workflow::inbox::Inbox::load_default();
    if inbox.len() == 0 {
        return;
    }
    let now = crate::shared::clock::now_epoch_ms();
    let mut rows = Vec::new();
    let has_section_header: bool = unsafe {
        msg_send![objc2::class!(NSMenuItem), respondsToSelector: sel!(sectionHeaderWithTitle:)]
    };
    let title = NSString::from_str("From iPhone");
    rows.push(if has_section_header {
        NSMenuItem::sectionHeaderWithTitle(&title, mtm)
    } else {
        let header = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &title,
                None,
                &NSString::new(),
            )
        };
        header.setEnabled(false);
        header
    });
    let icon = NSImage::imageWithSystemSymbolName_accessibilityDescription(
        &NSString::from_str("iphone"),
        None,
    );
    for entry in inbox.entries() {
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str(&entry.label(now)),
                Some(sel!(openInboxItem:)),
                &NSString::new(),
            )
        };
        unsafe {
            item.setTarget(Some(target));
            item.setRepresentedObject(Some(&NSString::from_str(&entry.dir.display().to_string())));
        }
        item.setImage(icon.as_deref());
        rows.push(item);
    }
    rows.push(NSMenuItem::separatorItem(mtm));
    for (index, item) in rows.iter().enumerate() {
        item.setTag(INBOX_MENU_TAG);
        menu.insertItem_atIndex(item, index as isize);
    }
}

pub(in crate::capture::desktop) fn set_status_text(text: &str) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    STATUS_BAR.with(|slot| {
        let slot = slot.borrow();
        let Some(button) = slot.as_ref().and_then(|bar| bar._item.button(mtm)) else {
            return;
        };
        button.setImagePosition(NSCellImagePosition::ImageLeft);
        button.setTitle(&NSString::from_str(text));
    });
}

/// Shows the unhandled iPhone capture count beside the menu bar icon.
pub(in crate::capture::desktop) fn set_status_inbox_count(count: usize) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    STATUS_BAR.with(|slot| {
        let slot = slot.borrow();
        let Some(button) = slot.as_ref().and_then(|bar| bar._item.button(mtm)) else {
            return;
        };
        button.setImagePosition(if count == 0 {
            NSCellImagePosition::ImageOnly
        } else {
            NSCellImagePosition::ImageLeft
        });
        button.setTitle(&NSString::from_str(&if count == 0 {
            String::new()
        } else {
            count.to_string()
        }));
    });
}

impl ApparentMenuTarget {
    fn new(sender: flume::Sender<MenuAction>, mtm: MainThreadMarker) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(MenuTargetIvars { sender });
        unsafe { msg_send![super(this), init] }
    }
}

struct StatusBarController {
    _item: Retained<NSStatusItem>,
    _menu: Retained<NSMenu>,
    _target: Retained<ApparentMenuTarget>,
    _appearance_app: Retained<NSApplication>,
}

impl Drop for StatusBarController {
    fn drop(&mut self) {
        unsafe {
            let _: () = msg_send![&*self._appearance_app, removeObserver: &*self._target,
                forKeyPath: &*NSString::from_str("effectiveAppearance")];
        }
    }
}

fn refresh_status_bar_icon(item: &NSStatusItem, mtm: MainThreadMarker) {
    let Some(button) = item.button(mtm) else {
        return;
    };
    // Full-screen menu bars can stay dark even while the system is light.
    // Follow the application's inherited system appearance in either context.
    let names = NSArray::from_retained_slice(&[
        NSString::from_str("NSAppearanceNameAqua"),
        NSString::from_str("NSAppearanceNameDarkAqua"),
    ]);
    let appearance_app = NSApplication::sharedApplication(mtm);
    let appearance = appearance_app.effectiveAppearance();
    let best: Option<Retained<NSString>> = unsafe {
        msg_send![&*appearance, bestMatchFromAppearancesWithNames: &*names]
    };
    let dark = best.is_some_and(|name| name.to_string() == "NSAppearanceNameDarkAqua");
    let bytes = super::status_icon(dark);
    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)) {
        image.setSize(NSSize::new(18.0, 18.0));
        // Preserve the purple glyph and its contrasting background.
        image.setTemplate(false);
        button.setImage(Some(&image));
    } else {
        button.setTitle(&NSString::from_str("✎"));
    }
}

thread_local! {
    static STATUS_BAR: RefCell<Option<StatusBarController>> = const { RefCell::new(None) };
}

/// The owned status-item window, in the same global top-left coordinates as capture.
pub(in crate::capture::desktop) fn status_bar_anchor()->Option<[f32;4]> {
    let mtm=MainThreadMarker::new()?;
    STATUS_BAR.with(|bar| {
        let bar=bar.borrow();let button=bar.as_ref()?._item.button(mtm)?;
        let frame=button.window()?.frame();
        let primary_h=objc2_app_kit::NSScreen::screens(mtm).firstObject()?.frame().size.height;
        Some([frame.origin.x as f32,(primary_h-frame.origin.y-frame.size.height) as f32,frame.size.width as f32,frame.size.height as f32])
    })
}

pub(in crate::capture::desktop) fn install_status_bar() -> Option<flume::Receiver<MenuAction>> {
    let mtm = MainThreadMarker::new()?;
    let (sender, receiver) = flume::bounded(16);
    let target = ApparentMenuTarget::new(sender, mtm);
    let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str("Apparent"));

    let add = |title: &str, action: objc2::runtime::Sel| {
        let item = unsafe {
            NSMenuItem::initWithTitle_action_keyEquivalent(
                NSMenuItem::alloc(mtm),
                &NSString::from_str(title),
                Some(action),
                &NSString::new(),
            )
        };
        unsafe { item.setTarget(Some(&target)) };
        menu.addItem(&item);
    };

    add(&record_menu_title(), sel!(toggleCapture:));
    if let Some(item) = menu.itemAtIndex(menu.numberOfItems() - 1) {
        item.setTag(RECORD_MENU_TAG);
    }
    add("Choose What to Record…", sel!(chooseTarget:));
    add("Microphone for next screen capture", sel!(toggleMicrophone:));
    if let Some(item) = menu.itemAtIndex(menu.numberOfItems() - 1) { item.setTag(MICROPHONE_MENU_TAG); }
    menu.addItem(&NSMenuItem::separatorItem(mtm));
    add("Open Latest Capture", sel!(openLatest:));
    add("Export Last Capture as Video…", sel!(exportVideo:));
    if let Some(item) = menu.itemAtIndex(menu.numberOfItems() - 1) {
        item.setTag(EXPORT_VIDEO_MENU_TAG);
        item.setHidden(!crate::shared::handoff::video_export());
    }
    menu.addItem(&NSMenuItem::separatorItem(mtm));
    add("Settings…", sel!(openSettings:));
    if let Some(item) = menu.itemAtIndex(menu.numberOfItems() - 1) {
        item.setKeyEquivalent(&NSString::from_str(","));
    }
    add("Check for Updates…", sel!(checkForUpdates:));
    add("Quit Apparent", sel!(quitApp:));
    if let Some(item) = menu.itemAtIndex(menu.numberOfItems() - 1) {
        item.setKeyEquivalent(&NSString::from_str("q"));
    }

    menu.setDelegate(Some(objc2::runtime::ProtocolObject::from_ref(&*target)));

    let item = NSStatusBar::systemStatusBar().statusItemWithLength(-1.0);
    refresh_status_bar_icon(&item, mtm);
    let appearance_app = NSApplication::sharedApplication(mtm);
    unsafe {
        let _: () = msg_send![&*appearance_app, addObserver: &*target,
            forKeyPath: &*NSString::from_str("effectiveAppearance"),
            options: 0usize, context: std::ptr::null_mut::<std::ffi::c_void>()];
    }
    item.setMenu(Some(&menu));

    STATUS_BAR.with(|slot| {
        *slot.borrow_mut() = Some(StatusBarController {
            _item: item,
            _menu: menu,
            _target: target,
            _appearance_app: appearance_app,
        });
    });
    Some(receiver)
}

fn find_picker_ns_window() -> Option<Retained<NSWindow>> {
    let mtm = MainThreadMarker::new()?;
    let app = NSApplication::sharedApplication(mtm);
    for win in app.windows() {
        if win.ignoresMouseEvents() {
            continue;
        }
        let size = win.frame().size;
        if size.width >= 600.0
            && size.height >= 200.0
            && (size.width - 1120.0).abs() > 8.0
        {
            return Some(win);
        }
    }
    None
}

fn sync_full_size_content_view(ns_window: &NSWindow) {
    for kind in [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ] {
        if let Some(button) = ns_window.standardWindowButton(kind) {
            button.setHidden(true);
        }
    }
    if let Some(cv) = ns_window.contentView() {
        let bounds = cv.bounds();
        for sub in cv.subviews() {
            sub.setFrame(bounds);
        }
        if let Some(frame_view) = unsafe { cv.superview() } {
            for sub in frame_view.subviews() {
                if sub
                    .class()
                    .name()
                    .to_bytes()
                    .windows(8)
                    .any(|w| w == b"Titlebar")
                {
                    sub.setHidden(true);
                }
            }
        }
    }
}

fn configure_floating_window(ns_window: &NSWindow, ignores_mouse: bool, level_offset: isize) {
    ns_window.setHidesOnDeactivate(false);
    ns_window.setIgnoresMouseEvents(ignores_mouse);
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor()));
    ns_window.setHasShadow(false);
    ns_window.setLevel(NSStatusWindowLevel + level_offset);
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    sync_full_size_content_view(ns_window);
}

pub(in crate::capture::desktop) fn capture_own_window_screenshot(
    window_num: Option<isize>,
    out_path: &std::path::Path,
) -> anyhow::Result<()> {
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if let Some(num) = window_num
        && num > 0
    {
        if let Some(frame) = capture_cg_window_rgba(num as u32) {
            crate::capture::engine::render::save_png(&frame, out_path)?;
            return Ok(());
        }
        if std::process::Command::new("/usr/sbin/screencapture")
            .args(["-x", "-l", &num.to_string()])
            .arg(out_path)
            .status()
            .is_ok_and(|s| s.success())
            && out_path.exists()
        {
            return Ok(());
        }
    }
    let pid = std::process::id() as i32;
    let content = SCShareableContent::get()
        .map_err(|e| anyhow::anyhow!("ScreenCaptureKit unavailable: {e}"))?;
    let window = content
        .windows()
        .into_iter()
        .filter(|w| {
            w.is_on_screen()
                && w.owning_application()
                    .as_ref()
                    .is_some_and(|a| a.process_id() == pid)
        })
        .max_by_key(|w| (w.frame().size.width as u64) * (w.frame().size.height as u64))
        .ok_or_else(|| anyhow::anyhow!("Could not find Apparent window"))?;
    let frame = window.frame();
    let filter = SCContentFilter::create()
        .with_window(&window)
        .build()
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let config = SCStreamConfiguration::new()
        .with_width((frame.size.width as u32 * 2).max(400))
        .with_height((frame.size.height as u32 * 2).max(300))
        .with_shows_cursor(false);
    let image =
        SCScreenshotManager::capture_image(&filter, &config).map_err(|e| anyhow::anyhow!("{e}"))?;
    image
        .save(
            out_path
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("invalid output path"))?,
            screencapturekit::screenshot_manager::ImageFormat::Png,
        )
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(())
}

fn capture_cg_window_rgba(window_id: u32) -> Option<crate::shared::model::RgbaFrame> {
    use core_graphics::geometry::{CGPoint, CGRect, CGSize};
    use std::ffi::c_void;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowListCreateImage(
            screen_bounds: CGRect,
            list_option: u32,
            window_id: u32,
            image_option: u32,
        ) -> *mut c_void;
        fn CGImageGetWidth(image: *const c_void) -> usize;
        fn CGImageGetHeight(image: *const c_void) -> usize;
        fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
        fn CGBitmapContextCreate(
            data: *mut c_void,
            width: usize,
            height: usize,
            bits_per_component: usize,
            bytes_per_row: usize,
            space: *const c_void,
            bitmap_info: u32,
        ) -> *mut c_void;
        fn CGContextDrawImage(context: *mut c_void, rect: CGRect, image: *const c_void);
        fn CFRelease(cf: *const c_void);
    }

    let null_rect = CGRect::new(
        &CGPoint::new(f64::INFINITY, f64::INFINITY),
        &CGSize::new(0.0, 0.0),
    );
    // kCGWindowListOptionIncludingWindow = 1 << 3 (8), kCGWindowImageBoundsIgnoreFraming = 1
    let cg_image = unsafe { CGWindowListCreateImage(null_rect, 8, window_id, 1) };
    if cg_image.is_null() {
        return None;
    }
    let width = unsafe { CGImageGetWidth(cg_image) };
    let height = unsafe { CGImageGetHeight(cg_image) };
    if width == 0 || height == 0 {
        unsafe { CFRelease(cg_image) };
        return None;
    }
    let mut rgba = vec![0_u8; width * height * 4];
    unsafe {
        let cs = CGColorSpaceCreateDeviceRGB();
        // kCGImageAlphaPremultipliedLast = 1
        let ctx =
            CGBitmapContextCreate(rgba.as_mut_ptr().cast(), width, height, 8, width * 4, cs, 1);
        if !ctx.is_null() {
            let draw_rect = CGRect::new(
                &CGPoint::new(0.0, 0.0),
                &CGSize::new(width as f64, height as f64),
            );
            CGContextDrawImage(ctx, draw_rect, cg_image);
            CFRelease(ctx);
        }
        if !cs.is_null() {
            CFRelease(cs);
        }
        CFRelease(cg_image);
    }
    Some(crate::shared::model::RgbaFrame::new(
        0,
        width as u32,
        height as u32,
        rgba,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "Mutates process-wide shutdown state; run this test alone on macOS"]
    fn native_quit_guard_cancels_busy_termination() {
        use crate::capture::desktop::workflow::shutdown;

        let class = AnyClass::get(c"GPUIApplicationDelegate").expect("GPUI 0.2.2 delegate");
        let will_terminate = class.instance_method(sel!(applicationWillTerminate:)).unwrap();
        let original = will_terminate.implementation() as *const ();
        let foreign = AnyClass::get(c"NSObject").unwrap();
        let foreign_method = foreign.instance_method(sel!(applicationShouldTerminate:))
            .map(|method| method.implementation() as *const ());
        assert!(!install_quit_guard(foreign));
        assert_eq!(foreign.instance_method(sel!(applicationShouldTerminate:))
            .map(|method| method.implementation() as *const ()), foreign_method);
        assert!(install_quit_guard(class));
        assert!(install_quit_guard(class));
        assert_eq!(will_terminate.implementation() as *const (), original);

        let delegate: Retained<AnyObject> = unsafe { msg_send![class, new] };
        let sender = NSObject::new();
        shutdown::set_phase_busy(false);
        let reply: usize = unsafe { msg_send![&*delegate, applicationShouldTerminate: &*sender] };
        assert_eq!(reply, 1);
        assert!(!shutdown::requested(), "run this test in its own test process");
        shutdown::set_phase_busy(true);
        let reply: usize = unsafe { msg_send![&*delegate, applicationShouldTerminate: &*sender] };
        assert_eq!(reply, 0);
        assert!(shutdown::requested());
        shutdown::set_phase_busy(false);
        let reply: usize = unsafe { msg_send![&*delegate, applicationShouldTerminate: &*sender] };
        assert_eq!(reply, 1, "drained shared shutdown may terminate");
    }

    #[test]
    fn reveal_appkit_queries_pass_objc2_verification() {
        let _ = reduce_motion();
        let cls = objc2::runtime::AnyClass::get(c"NSEvent").expect("NSEvent");
        let _: objc2_foundation::NSPoint = unsafe { msg_send![cls, mouseLocation] };
    }


}

/// The app behind a note, retained before Electron takes keyboard focus.
pub(in crate::capture::desktop) fn note_focus() -> (u64, u32) {
    let pid = crate::capture::engine::runtime::frontmost_external_pid().unwrap_or(0).max(0) as u32;
    (u64::from(pid), pid)
}
pub(in crate::capture::desktop) fn restore_note_focus(token: u64, owner: u32) {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    if token > 0 && token <= i32::MAX as u64 && token == u64::from(owner) {
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(token as i32) {
            let _ = app.activateWithOptions(NSApplicationActivationOptions::empty());
        }
    }
}
