// メニューバー用アイコンPNGを生成する（外部依存・画像生成AI不要）。
// - iconTemplate.png  : 待機中。リング（テンプレート画像＝黒+α、メニューバーが明暗に自動追従）
// - iconRecording.png : 録音中。赤い塗りつぶし円（非テンプレートで赤を維持）
import { PNG } from "pngjs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "..", "assets");

/** 中心からの距離に応じた被覆率（簡易アンチエイリアス）。0..1 */
function coverage(dist, radius, edge = 1) {
  if (dist <= radius - edge) return 1;
  if (dist >= radius + edge) return 0;
  return (radius + edge - dist) / (2 * edge);
}

/**
 * size×size の RGBA PNG を作る。
 * mode: "ring"（黒リング/テンプレート用）| "dot"（赤塗り円/録音用）
 */
function drawIcon(size, mode) {
  const png = new PNG({ width: size, height: size });
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const outer = size * 0.42;
  const innerHole = size * 0.24; // リングの内側

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy);
      let alpha = 0;
      if (mode === "dot") {
        alpha = coverage(d, outer);
      } else {
        // リング = 外円の被覆 − 内円の被覆
        alpha = Math.max(0, coverage(d, outer) - coverage(d, innerHole));
      }
      const idx = (size * y + x) << 2;
      if (mode === "dot") {
        png.data[idx] = 220; // R
        png.data[idx + 1] = 40; // G
        png.data[idx + 2] = 40; // B
      } else {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
      }
      png.data[idx + 3] = Math.round(alpha * 255);
    }
  }
  return PNG.sync.write(png);
}

await mkdir(assetsDir, { recursive: true });

const targets = [
  { name: "iconTemplate.png", size: 22, mode: "ring" },
  { name: "iconTemplate@2x.png", size: 44, mode: "ring" },
  { name: "iconRecording.png", size: 22, mode: "dot" },
  { name: "iconRecording@2x.png", size: 44, mode: "dot" },
];

for (const t of targets) {
  await writeFile(join(assetsDir, t.name), drawIcon(t.size, t.mode));
  console.log(`generated assets/${t.name}`);
}
