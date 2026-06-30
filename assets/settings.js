// 設定画面のロジック。window.api は preload(contextBridge) 経由。
const $ = (id) => document.getElementById(id);

async function init() {
  const [config, devices] = await Promise.all([
    window.api.getConfig(),
    window.api.listDevices().catch(() => []),
  ]);

  // マイク一覧（現在値が一覧に無くても選べるよう補完）
  const deviceSel = $("device");
  const names = devices.map((d) => d.name);
  if (config.deviceName && !names.includes(config.deviceName)) {
    names.unshift(config.deviceName);
  }
  deviceSel.innerHTML = "";
  for (const name of names) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    if (name === config.deviceName) opt.selected = true;
    deviceSel.appendChild(opt);
  }

  $("engine").value = config.engine;
  $("model").value = config.model ?? "";
  $("vocabulary").value = (config.vocabulary ?? []).join("\n");
  $("outputRoot").value = config.outputRoot;
  $("cloudConsent").checked = !!config.cloudConsent;
  $("liveCaption").checked = config.liveCaption !== false;
  $("liveModel").value = config.liveModel ?? "";

  $("save").addEventListener("click", () => void save(config));
  $("checkDeps").addEventListener("click", () => void runDepCheck());
}

async function save(base) {
  const vocabulary = $("vocabulary")
    .value.split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const next = {
    ...base,
    deviceName: $("device").value || base.deviceName,
    engine: $("engine").value,
    model: $("model").value.trim() || undefined,
    vocabulary,
    outputRoot: $("outputRoot").value.trim() || base.outputRoot,
    cloudConsent: $("cloudConsent").checked,
    liveCaption: $("liveCaption").checked,
    liveModel: $("liveModel").value.trim() || base.liveModel,
  };

  await window.api.saveConfig(next);
  const status = $("status");
  status.textContent = "保存しました";
  setTimeout(() => (status.textContent = ""), 2000);
}

async function runDepCheck() {
  const el = $("deps");
  el.textContent = "確認中 …";
  try {
    const results = await window.api.checkDeps();
    el.innerHTML = results
      .map(
        (r) =>
          `<span class="${r.ok ? "ok" : "ng"}">${r.ok ? "✓" : "✗"} ${r.name}</span>: ` +
          `${r.detail}${r.hint ? `（${r.hint}）` : ""}`,
      )
      .join("<br>");
  } catch (e) {
    el.textContent = "確認に失敗しました: " + (e?.message ?? e);
  }
}

init();
