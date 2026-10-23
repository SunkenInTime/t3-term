// Entry for compiled binaries. Bun does not embed gpuix's platform addon on its
// own, so scripts/build.ts embeds the .node file and this points the napi-rs
// loader at it before @gpuix/native loads.
import nativePath from "./generated/nativeEmbed.ts";

if (nativePath !== null) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath;
await import("./main.tsx");
