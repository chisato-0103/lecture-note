import { describe, it, expect } from "vitest";
import {
  parseAvfoundationAudioDevices,
  resolveDeviceIndex,
  parseAstatsLevel,
  dbToLevel,
} from "./record.js";

const SAMPLE_STDERR = `
[AVFoundation indev @ 0x123] AVFoundation video devices:
[AVFoundation indev @ 0x123] [0] FaceTime HD Camera
[AVFoundation indev @ 0x123] AVFoundation audio devices:
[AVFoundation indev @ 0x123] [0] Microsoft Teams Audio
[AVFoundation indev @ 0x123] [1] MacBook Airのマイク
[AVFoundation indev @ 0x123] [2] ちさとのマイク
`;

describe("parseAvfoundationAudioDevices", () => {
  it("audio セクションのデバイスのみ抽出する（video は除外）", () => {
    const devices = parseAvfoundationAudioDevices(SAMPLE_STDERR);
    expect(devices).toEqual([
      { index: 0, name: "Microsoft Teams Audio" },
      { index: 1, name: "MacBook Airのマイク" },
      { index: 2, name: "ちさとのマイク" },
    ]);
  });

  it("出力が無ければ空配列", () => {
    expect(parseAvfoundationAudioDevices("")).toEqual([]);
  });
});

describe("resolveDeviceIndex", () => {
  const devices = parseAvfoundationAudioDevices(SAMPLE_STDERR);

  it("完全一致を解決する", () => {
    expect(resolveDeviceIndex(devices, "MacBook Airのマイク")).toBe(1);
  });

  it("部分一致でも解決する", () => {
    expect(resolveDeviceIndex(devices, "ちさと")).toBe(2);
  });

  it("見つからなければ undefined", () => {
    expect(resolveDeviceIndex(devices, "存在しないマイク")).toBeUndefined();
  });
});

describe("parseAstatsLevel", () => {
  it("Peak 行を解析する", () => {
    expect(parseAstatsLevel("lavfi.astats.Overall.Peak_level=-24.259720")).toEqual({
      kind: "peak",
      db: -24.25972,
    });
  });

  it("RMS 行を解析する", () => {
    expect(parseAstatsLevel("lavfi.astats.Overall.RMS_level=-35.472187")).toEqual({
      kind: "rms",
      db: -35.472187,
    });
  });

  it("無音の -inf は -90dB に丸める", () => {
    expect(parseAstatsLevel("lavfi.astats.Overall.Peak_level=-inf")).toEqual({
      kind: "peak",
      db: -90,
    });
  });

  it("レベル行でなければ null", () => {
    expect(parseAstatsLevel("frame:6    pts:32384   pts_time:0.674667")).toBeNull();
  });
});

describe("dbToLevel", () => {
  it("-90dB 以下は 0、0dB 以上は 1 にクランプ", () => {
    expect(dbToLevel(-90)).toBe(0);
    expect(dbToLevel(-120)).toBe(0);
    expect(dbToLevel(0)).toBe(1);
    expect(dbToLevel(5)).toBe(1);
  });

  it("中間を線形マップする（-30dB→0.5）", () => {
    expect(dbToLevel(-30)).toBeCloseTo(0.5, 5);
  });
});
