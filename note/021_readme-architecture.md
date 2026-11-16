# 021 README にアーキテクチャ図を追加

## 目的
README を読んだ人が、アプリ・Supabase・Google Apps Script・Gemini API のつながりをひと目で把握できるようにする。

## 変更内容
- `README.md`: 「アーキテクチャ」節を追加。図と、各部分の役割の箇条書き（アプリ / 自動取り込み / レシート読み取り / 自動分類）。
- `docs/architecture.svg`: 各サービスのアイコンを使ったアーキテクチャ図。

## 設計判断
- 最初は Mermaid で図を書いた（コミット `3da8677`）。その後、アイコン付きの SVG に置き換えた。Mermaid は GitHub 上で任意のアイコンを表示できないため。
- 図は手書きの SVG 1 枚にした。README からは `<img>` で読み込むので、外部のフォントや画像を参照せず、アイコンのパスを SVG に埋め込んだ。
- 背景は SVG 自身に塗った。GitHub のダークモードでも文字が読めるようにするため。
- アイコンは Simple Icons（CC0。https://simpleicons.org ）のパスを使い、各ブランドの色を付けた。Gemini のアイコンのグラデーションは近い色を自分で当てたもので、公式の色指定ではない。ロゴの商標は各社に帰属する。
- 必須の構成は実線、任意の機能（自動取り込み・レシート読み取り）は点線と「任意」のラベルで区別した。
- 図の内容は、コード（`lib/supabase.ts`、`components/*.tsx`、`app/api/receipt/route.ts`、`gas/Code.gs`、`schema.sql`）を読んで書いた。

## 動作確認
- macOS の Quick Look（`qlmanage`）で SVG を PNG に描画し、文字のはみ出しと矢印の位置を目視で確認した。
- 未確認: GitHub 上での表示（ライトモード・ダークモード）。
