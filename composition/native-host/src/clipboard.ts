/** The Record clipboard capability is separate from the generic host and pen facades. */
export { createNativeClipboardPort, createNativeClipboardPngTextPort } from './client.js';
export type { NativeClipboardPort, NativeClipboardWriteResult, NativeClipboardPngTextPort, NativeClipboardPngTextWriteResult } from '@apparent/app-contracts/native';
export { MAX_SERIALIZED_FRAME_BYTES, MAX_UTF8_TEXT_BYTES, MAX_PNG_BYTES, MAX_PNG_DIMENSION, MAX_PNG_DECODED_BYTES, MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES } from '@apparent/app-contracts/native';
