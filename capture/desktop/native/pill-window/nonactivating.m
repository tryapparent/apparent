// Mac window mechanics, called only by trusted Electron main before admission.
#import <AppKit/AppKit.h>
#include <node_api.h>
#include <math.h>
#include <stdint.h>

@interface NSWindow (ApparentNonactivation)
- (void)_setPreventsActivation:(BOOL)preventsActivation;
@end

static napi_value refuse(napi_env env) {
    napi_throw_error(env, "APPARENT_PILL_WINDOW", "Recording-controls window could not be configured");
    return NULL;
}

static napi_value preventActivation(napi_env env, napi_callback_info info) {
    size_t count = 2;
    napi_value args[2];
    double windowId = 0;
    if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok || count != 1 ||
        napi_get_value_double(env, args[0], &windowId) != napi_ok || !isfinite(windowId) ||
        windowId < 1 || windowId > UINT32_MAX || floor(windowId) != windowId ||
        ![NSThread isMainThread] || !NSApp)
        return refuse(env);
    @autoreleasepool {
        @try {
            NSWindow *target = nil;
            NSArray<NSWindow *> *windows = NSApp.windows;
            if (windows.count > 16) return refuse(env);
            for (NSWindow *window in windows) {
                if (window.windowNumber != (NSInteger)windowId) continue;
                if (target) return refuse(env);
                target = window;
            }
            // No raw pointers or foreign-process lookup. The renderer cannot
            // call this entrypoint, choose an ID or change the native title.
            if (!target || ![target.title isEqualToString:@"Apparent recording controls"] ||
                !(target.styleMask & NSWindowStyleMaskNonactivatingPanel) ||
                !target.canBecomeKeyWindow || NSApp.activationPolicy != NSApplicationActivationPolicyAccessory ||
                ![target respondsToSelector:@selector(_setPreventsActivation:)])
                return refuse(env);
            // The existing native pill uses this guarded AppKit mechanism.
            // Retain keyboard eligibility while setting the WindowServer tag.
            [target _setPreventsActivation:YES];
            napi_value result;
            if (napi_get_boolean(env, true, &result) != napi_ok) return refuse(env);
            return result;
        } @catch (NSException *exception) {
            return refuse(env);
        }
    }
}

static napi_value initialize(napi_env env, napi_value exports) {
    napi_property_descriptor property = {
        .utf8name = "preventActivation", .method = preventActivation, .attributes = napi_default
    };
    if (napi_define_properties(env, exports, 1, &property) != napi_ok) return refuse(env);
    return exports;
}
NAPI_MODULE(apparent_pill_window, initialize)
