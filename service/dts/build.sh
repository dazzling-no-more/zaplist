#!/bin/bash
# Builds dts.wasm: FFmpeg's DTS decoder (LGPL-2.1-or-later) with bridge.c, as WebAssembly 1.0 with
# none of the later features (sign extension, bulk memory...), which the Node.js 8 of webOS 5 and 6
# can't compile. Run from the repository, with Docker:
#
#   docker run --rm -v "$PWD/service/dts:/src" emscripten/emsdk:3.1.25 bash /src/build.sh
#
# The result is committed (service/dts/dts.wasm); scripts/build-service.mjs copies it next to the
# service. Replacing it with another build of FFmpeg's decoder works as long as bridge.c's functions stay.
set -euo pipefail
FFMPEG=ffmpeg-7.1
SHA256=40973d44970dbc83ef302b0609f2e74982be2d85916dd2ee7472d30678a7abe6
MVP="-mcpu=mvp"

cd /tmp
curl -sSfLO "https://ffmpeg.org/releases/$FFMPEG.tar.xz"
echo "$SHA256  $FFMPEG.tar.xz" | sha256sum -c -
tar xf "$FFMPEG.tar.xz"
cd "$FFMPEG"
emconfigure ./configure --target-os=none --arch=x86_32 --enable-cross-compile \
  --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm \
  --disable-everything --enable-decoder=dca \
  --disable-programs --disable-doc --disable-avdevice --disable-avformat --disable-swscale --disable-swresample \
  --disable-avfilter --disable-network --disable-pthreads --disable-asm --disable-debug --disable-runtime-cpudetect \
  --disable-autodetect --extra-cflags="-O3 $MVP" --extra-ldflags="$MVP"
emmake make -j"$(nproc)" libavcodec/libavcodec.a libavutil/libavutil.a
emcc -O3 $MVP -I. /src/bridge.c libavcodec/libavcodec.a libavutil/libavutil.a -o /src/dts.wasm \
  --no-entry -sSTANDALONE_WASM -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=33554432 -sTOTAL_STACK=1048576 -sWASM_BIGINT=0 -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_dts_open,_dts_input,_dts_decode,_dts_output,_dts_channels,_dts_rate,_dts_close,_malloc
