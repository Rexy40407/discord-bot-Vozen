#!/usr/bin/env python3
"""Sidecar de STT persistente para o Vozen (Fase 4).

Carrega o modelo faster-whisper UMA vez e transcreve N pedidos — o padrao dos sidecars
clone/kokoro (evita pagar o cold-load por utterance). Protocolo simples de linhas:

  entrada (stdin):  1 LINHA = caminho de um ficheiro WAV a transcrever
  saida (stdout):   1 LINHA JSON por pedido -> {"text": "...", "lang": "en"}  ou  {"error": "..."}
  arranque:         emite {"ready": true, "model": "..."} depois de carregar o modelo

faster-whisper reamostra o audio internamente (via av/ffmpeg), por isso aceita WAV a
qualquer taxa (o recorder do bot da 48kHz). vad_filter corta silencio (melhor precisao +
menos tokens). beam_size=1 (greedy) para latencia baixa (STT ao vivo). Ver docs/SPIKE-STT.md.
"""
import sys
import json
import argparse


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="base")
    ap.add_argument("--compute", default="int8")
    ap.add_argument("--threads", type=int, default=2)
    args = ap.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(
        args.model, device="cpu", compute_type=args.compute, cpu_threads=args.threads
    )
    print(json.dumps({"ready": True, "model": args.model}), flush=True)

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            segments, info = model.transcribe(path, beam_size=1, vad_filter=True)
            text = " ".join(s.text.strip() for s in segments).strip()
            print(json.dumps({"text": text, "lang": info.language}), flush=True)
        except Exception as e:  # noqa: BLE001 — devolve o erro ao chamador, nunca crasha o sidecar
            print(json.dumps({"error": str(e)[:200]}), flush=True)


if __name__ == "__main__":
    main()
