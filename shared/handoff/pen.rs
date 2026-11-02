//! Validated pen preference. The renderer never writes configuration directly.
use std::sync::atomic::{AtomicU32,Ordering};
static COLOR:AtomicU32=AtomicU32::new(0xff3b30);
pub fn rgb()->[u8;3] {let n=COLOR.load(Ordering::Relaxed);[(n>>16) as u8,(n>>8) as u8,n as u8]}
pub fn palette(name:&str)->Option<[u8;3]> {match name {"coral"=>Some([217,76,68]),"purple"=>Some([122,88,199]),"blue"=>Some([59,121,189]),"green"=>Some([57,123,97]),_=>None}}
fn apply(rgb:[u8;3]) {COLOR.store((u32::from(rgb[0])<<16)|(u32::from(rgb[1])<<8)|u32::from(rgb[2]),Ordering::Relaxed);}
pub fn refresh() {let config=super::load_config_from(&super::default_config_path());apply(config.pen_color.as_deref().and_then(palette).unwrap_or([255,59,48]));}
pub fn save(name:&str)->anyhow::Result<()> {let rgb=palette(name).ok_or_else(||anyhow::anyhow!("Unknown pen colour"))?;super::set_config_value_in(&super::default_config_path(),"penColor",name.into())?;apply(rgb);Ok(())}
#[cfg(test)] mod tests{use super::*;#[test]fn only_known_colours_are_accepted(){assert_eq!(palette("purple"),Some([122,88,199]));assert_eq!(palette("#123456"),None);}}
