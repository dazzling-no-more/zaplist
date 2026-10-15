// DTS audio to 16-bit PCM for the app's service (service/dts.ts), with FFmpeg's DTS decoder, built
// to WebAssembly by build.sh. Only 32-bit values cross to JavaScript: Node.js 8 has no BigInt.
#include <stdarg.h>
#include <stdint.h>
#include <stdlib.h>
#include <emscripten.h>
#include "libavcodec/avcodec.h"
#include "libavutil/opt.h"

typedef struct {
  AVCodecContext *codec;
  AVPacket *packet;
  AVFrame *frame;
  /* Interleaved output of the last dts_decode, and its room in samples (all channels). */
  int16_t *pcm;
  int room;
} Decoder;

static void quiet(void *object, int level, const char *format, va_list args) {}

EMSCRIPTEN_KEEPALIVE
void dts_close(Decoder *d) {
  if (!d) return;
  avcodec_free_context(&d->codec);
  av_packet_free(&d->packet);
  av_frame_free(&d->frame);
  free(d->pcm);
  free(d);
}

/* A decoder of the DTS core: the lossless (DTS-HD MA) and high-rate extensions cost far more to
   decode, and every DTS stream carries the core. NULL if it can't open. */
EMSCRIPTEN_KEEPALIVE
Decoder *dts_open(void) {
  av_log_set_callback(quiet);
  const AVCodec *dts = avcodec_find_decoder(AV_CODEC_ID_DTS);
  Decoder *d = calloc(1, sizeof(Decoder));
  if (!dts || !d) return NULL;
  d->codec = avcodec_alloc_context3(dts);
  d->packet = av_packet_alloc();
  d->frame = av_frame_alloc();
  if (!d->codec || !d->packet || !d->frame || av_opt_set_int(d->codec, "core_only", 1, AV_OPT_SEARCH_CHILDREN) < 0 || avcodec_open2(d->codec, dts, NULL) < 0) {
    dts_close(d);
    return NULL;
  }
  return d;
}

/* Room for a frame of `size` bytes, to fill before dts_decode. */
EMSCRIPTEN_KEEPALIVE
uint8_t *dts_input(Decoder *d, int size) {
  av_packet_unref(d->packet);
  return av_new_packet(d->packet, size) < 0 ? NULL : d->packet->data;
}

static int16_t clip(float v) {
  return v >= 1.0f ? 32767 : v <= -1.0f ? -32768 : (int16_t)(v * 32767.0f);
}

/* Decodes the frame given to dts_input into dts_output: interleaved PCM of `channels` channels (0: as
   many as the stream has), the decoder's own in its order, which is a WAVE file's, then silence for
   any more. Returns the samples per channel, or a negative error for a broken frame. */
EMSCRIPTEN_KEEPALIVE
int dts_decode(Decoder *d, int channels) {
  int ret = avcodec_send_packet(d->codec, d->packet);
  av_packet_unref(d->packet);
  if (ret < 0) return ret;
  int total = 0;
  while ((ret = avcodec_receive_frame(d->codec, d->frame)) >= 0) {
    AVFrame *f = d->frame;
    int in = f->ch_layout.nb_channels;
    int out = channels ? channels : in;
    int need = (total + f->nb_samples) * out;
    if (need > d->room) {
      int16_t *pcm = realloc(d->pcm, need * 2 * sizeof(int16_t));
      if (!pcm) return AVERROR(ENOMEM);
      d->pcm = pcm;
      d->room = need * 2;
    }
    int16_t *to = d->pcm + total * out;
    for (int c = 0; c < out; c++) {
      if (c >= in) {
        for (int s = 0; s < f->nb_samples; s++) to[s * out + c] = 0;
      } else if (f->format == AV_SAMPLE_FMT_FLTP) {
        const float *from = (const float *)f->extended_data[c];
        for (int s = 0; s < f->nb_samples; s++) to[s * out + c] = clip(from[s]);
      } else if (f->format == AV_SAMPLE_FMT_S32P) {
        const int32_t *from = (const int32_t *)f->extended_data[c];
        for (int s = 0; s < f->nb_samples; s++) to[s * out + c] = (int16_t)(from[s] >> 16);
      } else if (f->format == AV_SAMPLE_FMT_S16P) {
        const int16_t *from = (const int16_t *)f->extended_data[c];
        for (int s = 0; s < f->nb_samples; s++) to[s * out + c] = from[s];
      } else {
        for (int s = 0; s < f->nb_samples; s++) to[s * out + c] = 0;
      }
    }
    total += f->nb_samples;
    av_frame_unref(f);
  }
  return ret == AVERROR(EAGAIN) || ret == AVERROR_EOF ? total : ret;
}

EMSCRIPTEN_KEEPALIVE
int16_t *dts_output(Decoder *d) {
  return d->pcm;
}

EMSCRIPTEN_KEEPALIVE
int dts_channels(Decoder *d) {
  return d->codec->ch_layout.nb_channels;
}

EMSCRIPTEN_KEEPALIVE
int dts_rate(Decoder *d) {
  return d->codec->sample_rate;
}
