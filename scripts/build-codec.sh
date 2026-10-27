#!/bin/sh
# Requires emcc/emcmake (Emscripten 4.0.16), cmake, git. Output is shipped in public/.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD="$ROOT/native/build"
mkdir -p "$BUILD"
if [ ! -d "$BUILD/libjpeg" ]; then
  git clone --depth 1 --branch 3.1.2 https://github.com/libjpeg-turbo/libjpeg-turbo.git "$BUILD/libjpeg"
fi
cp "$ROOT/native/jmemopfs.c" "$BUILD/libjpeg/src/jmemnobs.c"
emcmake cmake -S "$BUILD/libjpeg" -B "$BUILD/obj" -DENABLE_SHARED=OFF -DWITH_SIMD=OFF -DWITH_TURBOJPEG=OFF -DWITH_ARITH_ENC=OFF -DCMAKE_C_FLAGS=-DUSE_CLZ_INTRINSIC -DCMAKE_BUILD_TYPE=MinSizeRel
cmake --build "$BUILD/obj" --target jpeg-static -j 4
emcc "$ROOT/native/jpeg.c" "$BUILD/obj/libjpeg.a" -I "$BUILD/libjpeg/src" -I "$BUILD/obj" -Oz \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 -s MAXIMUM_MEMORY=100663296 -s FILESYSTEM=0 -s MALLOC=emmalloc \
  -s EXPORTED_RUNTIME_METHODS='["UTF8ToString","HEAPU8"]' -s INCOMING_MODULE_JS_API='["locateFile","wasmBinary","readInput","scratchIO","writeTile","ioError"]' \
  -o "$ROOT/public/codecs/jpeg.js"
cat "$BUILD/libjpeg/LICENSE.md" "$BUILD/libjpeg/README.ijg" > "$ROOT/public/codecs/LICENSE-libjpeg.txt"
