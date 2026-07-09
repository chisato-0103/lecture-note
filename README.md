# lecture-note

講義を録音し、自動で「文字起こし → 整形 → 要約」して階層 Markdown ノートを生成する Mac 用ツール。

詳細仕様は [仕様書.md](仕様書.md) を参照。

## 前提

- macOS (Apple Silicon)
- `ffmpeg`（`brew install ffmpeg`）
- `mlx_whisper`（`pip3 install mlx-whisper`）
- （ライブ字幕を使う場合）モデルを事前取得: `hf download mlx-community/whisper-small-mlx`（完全オフラインで動かすため。より軽くするなら `whisper-base-mlx`）
- 要約に `claude`（Claude Code）または `ollama`
  - ⚠️ `claude -p` はサブスクログイン時のみ追加課金なし。`ANTHROPIC_API_KEY` が設定されていると API 従量課金になるため、本ツールは既定で実行を止める（意図的に使うなら `--allow-api`）

## セットアップ

```bash
npm install
npm run build   # dist/ に出力（lecture-note コマンドとして使う場合）
```

## 使い方

### メニューバーアプリ（GUI）

```bash
npm run app   # アイコン生成→ビルド→Electron 起動。メニューバーから録音/停止
```

メニューバーのアイコンをクリック → 「● 録音開始」→ 講義後「■ 停止してノート化」。
完了すると通知が出てノートが開く。録音中はアイコンが赤丸＋経過時間表示。

停止後は**すぐにフタを閉じて移動して構わない**。文字起こし（ローカル）と要約はバックグラウンドで進み、途中で中断（スリープ・WiFi 切替・終了）しても失われない。未完の録音は**次回起動時・スリープ復帰時に自動で続きから処理**される（文字起こしはネット不要なので復帰後すぐ完了し、要約はネットが安定したときに再試行される）。要約に claude を使う場合、初回の停止時にクラウド送信へ同意すると、以降の録音も自動でバックグラウンド要約される（設定でいつでも ollama に変更できる）。

「設定 …」からマイク・要約エンジン・固有名詞リスト・保存先を編集できる。
録音前に「授業資料を添付…」でスライド等(PDF/Word/txt)を選ぶと、要約時に用語・構成の参考に使われる。

#### ライブ字幕（録音中の動作確認）

録音中、画面下中央に**録音モニタ**（音声レベルバー＋速報の文字起こし）を最前面ウィンドウで表示する（「ちゃんと声を拾えているか」の確認用）。
**音声レベルバーは録音中つねに表示**。**字幕テキストはメニューバーの「字幕テキストを表示」からいつでもオン/オフ**でき、オフ時は文字起こし（Whisper）を一時停止してバッテリーを節約する（レベルバーは出たまま）。
完全オフラインの速報用モデル（既定 `whisper-small-mlx`）で動くため**精度は速報レベル**。**最終ノートは従来どおり**停止後の高精度バッチ（`large-v3-turbo`）で生成される。
モデル未取得やエラー時は**字幕テキストだけ出なくなる**が、録音・ノート化・レベルバーは通常どおり続く。字幕テキストの初期オン/オフは設定の `liveCaption`、モデルは `liveModel` で変更できる。

### .app にパッケージング

```bash
npm run dist       # dist/mac/ に .app（未署名・動作確認用）
npm run dist:dmg   # dmg 作成
```

設定は `~/Library/Application Support/講義ノート/config.json` に保存される。

### CLI

```bash
# 録音 → Ctrl-C で停止 → 文字起こし → 整形 → 要約 → 保存
npm run dev -- record --device "MacBook Airのマイク"

# 既存の音声ファイルから
npm run dev -- ./lecture.m4a

# 授業資料(PDF/Word/txt)を参考に渡す（用語・構成の精度向上）
npm run dev -- ./lecture.m4a --material slides.pdf --material handout.docx

# 既存の文字起こしテキストから要約だけ
npm run dev -- summarize ./文字起こし.txt

# マイク一覧
npm run dev -- devices
```

出力先（既定）: `~/Documents/講義ノート/YYYY-MM-DD_HHMM_<名前>/`
- `録音.wav`（record 時）/ `文字起こし.txt`（整形済み）/ `ノート.md`

### 主なオプション

| オプション | 説明 |
|---|---|
| `--device <名前>` | 録音マイク名（既定: MacBook Airのマイク） |
| `--engine <claude\|ollama>` | 要約エンジン（既定: claude） |
| `--model <名前>` | 要約モデル |
| `--out <ディレクトリ>` | 保存先ルート |
| `--max-repeats <数>` | 幻聴ループ除去のしきい値（既定: 5） |
| `--max-chars <数>` | 1チャンクの最大文字数（既定: 24000） |
| `--allow-api` | API 従量課金を明示許可 |

## 開発

```bash
npm test        # Vitest（ロジック層）
npm run typecheck
```

## 進捗

- [x] ① CLI コア（文字起こし→整形→要約→保存、段階要約、課金ガード）
- [x] ② 録音モジュール（ffmpeg、デバイス名解決、一時ファイル検証）
- [x] ③ メニューバー UI（Electron Tray、録音/停止/通知、状態機械、自前アイコン）
- [x] ④ 設定画面（マイク/エンジン/モデル/固有名詞/保存先）、設定永続化、依存チェック、クラウド要約の同意ゲート、electron-builder パッケージング設定
- [x] ⑤ ライブ字幕(MVP)（録音中に速報文字起こしを最前面ウィンドウ表示。ffmpeg多出力＋mlx_whisper常駐ヘルパー＋セグメント監視。失敗時は自動OFF）
- [x] ⑥ ライブ字幕の音声レベルメーター（astats→stdout、約150ms間引き、レベルバー表示）＋ロジック層テスト
- [x] ⑦ 依存チェック統合（起動時＆設定画面で Python(mlx_whisper)/ライブモデルの取得を確認）＋設定UIにライブ字幕の有効・モデル切替
- [ ] ⑧ 実機検証（フルスクリーン重なり(#36364)・透過背景・フォーカス、実マイク＋モデルでの動作確認）
