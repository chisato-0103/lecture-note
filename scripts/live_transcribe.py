#!/usr/bin/env python3
"""ライブ字幕用の常駐文字起こしヘルパー。

stdin から WAV クリップの絶対パスを1行ずつ受け取り、mlx_whisper で文字起こしして
stdout に JSON 1行（{"text": "..."} または {"error": "..."}）を返す。

モデルは mlx_whisper 内部の ModelHolder がプロセス内キャッシュするため、同じ
path_or_hf_repo を渡し続ける限りロードは初回のみ（＝常駐）。CLI を毎回起動する
方式と違いモデル再ロードが走らない。

注意:
- word_timestamps=False 必須（True は既知のメモリリーク #1254）
- condition_on_previous_text=False（クリップ独立・幻覚伝播の抑止）
- verbose=False でも tqdm 進捗は stderr に出る。stdout は JSON のみでクリーン
- 完全オフラインは呼び出し側が HF_HUB_OFFLINE=1 ＋ モデル事前DLで担保する
"""
import sys
import json


def main() -> None:
    # argv[1]=モデルrepo, argv[2]=initial_prompt（任意・固有名詞バイアス）
    repo = sys.argv[1] if len(sys.argv) > 1 else "mlx-community/whisper-base-mlx"
    initial_prompt = sys.argv[2] if len(sys.argv) > 2 else None

    import mlx_whisper  # import 自体が重いのでヘルパー起動時に一度だけ

    def transcribe(path: str) -> dict:
        r = mlx_whisper.transcribe(
            path,
            path_or_hf_repo=repo,
            language="ja",
            word_timestamps=False,
            condition_on_previous_text=False,
            initial_prompt=initial_prompt,
            verbose=False,
        )
        return {"text": (r.get("text") or "").strip()}

    # ウォームアップ: 起動直後にモデルロード遅延を前倒しする。
    # 専用の無音クリップは作らず、最初の実クリップで自然にロードされる方式でも可だが、
    # ここで READY を出して呼び出し側が「常駐準備完了」を検知できるようにする。
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            out = transcribe(path)
        except Exception as e:  # noqa: BLE001 ライブ字幕は落とさず error を返す
            out = {"error": str(e)}
        sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
