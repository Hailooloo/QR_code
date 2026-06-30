/* 二维码生成器交互逻辑 */
(function () {
  "use strict";

  // 预设颜色：纯色 + 彩虹混色（渐变）
  var PRESET_COLORS = [
    { name: "经典黑", type: "solid", value: "#1e293b" },
    { name: "靛蓝", type: "solid", value: "#4f46e5" },
    { name: "翡翠绿", type: "solid", value: "#059669" },
    { name: "玫红", type: "solid", value: "#db2777" },
    { name: "橙金", type: "solid", value: "#ea580c" },
    {
      name: "彩虹混色",
      type: "gradient",
      rainbow: true,
      value: {
        type: "diagonal",
        stops: [
          { offset: 0.0, color: "#ef4444" },
          { offset: 0.25, color: "#f59e0b" },
          { offset: 0.5, color: "#22c55e" },
          { offset: 0.75, color: "#06b6d4" },
          { offset: 1.0, color: "#a855f7" }
        ]
      }
    }
  ];

  // 默认使用经典黑
  var state = {
    color: PRESET_COLORS[0].value, // 当前颜色（字符串或渐变对象）
    text: "",
    logoDataUrl: null,
    logoName: "",
    generated: false
  };

  // DOM 引用
  var linkInput = document.getElementById("linkInput");
  var imgInput = document.getElementById("imgInput");
  var uploadBox = document.getElementById("uploadBox");
  var thumb = document.getElementById("thumb");
  var thumbImg = document.getElementById("thumbImg");
  var thumbName = document.getElementById("thumbName");
  var thumbRemove = document.getElementById("thumbRemove");
  var colorsBox = document.getElementById("colors");
  var colorPanel = document.getElementById("colorPanel");
  var colorPicker = document.getElementById("colorPicker");
  var genBtn = document.getElementById("genBtn");
  var canvas = document.getElementById("qrCanvas");
  var placeholder = document.getElementById("placeholder");
  var downloadBtn = document.getElementById("downloadBtn");
  var dlRow = document.getElementById("dlRow");
  var toastEl = document.getElementById("toast");

  /* ---------- 颜色色块渲染（数据驱动，复用模板） ---------- */
  function clearActive() {
    document.querySelectorAll(".swatch").forEach(function (el) {
      el.classList.remove("active");
    });
  }

  function renderColors() {
    PRESET_COLORS.forEach(function (c, idx) {
      var sw = document.createElement("div");
      sw.className = "swatch" + (c.rainbow ? " rainbow" : "") + (idx === 0 ? " active" : "");
      if (!c.rainbow) sw.style.background = c.value;
      sw.title = c.name;
      sw.addEventListener("click", function () {
        state.color = c.value;
        clearActive();
        sw.classList.add("active");
        // 取色器同步为色块的代表色
        if (c.type === "solid") {
          colorPicker.value = c.value;
        }
        applyColor();
      });
      colorsBox.appendChild(sw);
    });
  }

  /* ---------- Toast 提示 ---------- */
  var toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", !!isError);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
    }, 2600);
  }

  /* ---------- 图片上传处理 ---------- */
  function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast("请上传图片文件", true);
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      state.logoDataUrl = e.target.result;
      state.logoName = file.name;
      thumbImg.src = state.logoDataUrl;
      thumbName.textContent = file.name;
      thumb.classList.add("show");
      // 若已生成，更换 logo 后实时重绘
      if (state.generated) applyColor();
    };
    reader.readAsDataURL(file);
  }

  imgInput.addEventListener("change", function (e) {
    handleFile(e.target.files[0]);
  });

  // 拖拽上传
  ["dragenter", "dragover"].forEach(function (ev) {
    uploadBox.addEventListener(ev, function (e) {
      e.preventDefault();
      uploadBox.classList.add("drag");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    uploadBox.addEventListener(ev, function (e) {
      e.preventDefault();
      uploadBox.classList.remove("drag");
    });
  });
  uploadBox.addEventListener("drop", function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  thumbRemove.addEventListener("click", function (e) {
    e.stopPropagation();
    state.logoDataUrl = null;
    state.logoName = "";
    imgInput.value = "";
    thumb.classList.remove("show");
    if (state.generated) applyColor();
  });

  /* ---------- Logo 合成 ---------- */
  function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function composeLogo(ctx, size) {
    return new Promise(function (resolve) {
      if (!state.logoDataUrl) {
        resolve();
        return;
      }
      var logo = new Image();
      logo.onload = function () {
        var logoSize = Math.round(size * 0.22);
        var pad = Math.round(logoSize * 0.16);
        var box = logoSize + pad * 2;
        var x = (size - box) / 2;
        var y = (size - box) / 2;
        var radius = Math.round(box * 0.22);

        ctx.save();
        ctx.fillStyle = "#ffffff";
        drawRoundedRect(ctx, x, y, box, box, radius);
        ctx.fill();

        drawRoundedRect(ctx, x + pad, y + pad, logoSize, logoSize, Math.round(logoSize * 0.2));
        ctx.clip();
        ctx.drawImage(logo, x + pad, y + pad, logoSize, logoSize);
        ctx.restore();
        resolve();
      };
      logo.onerror = function () { resolve(); };
      logo.src = state.logoDataUrl;
    });
  }

  /* ---------- 核心渲染（使用 state.text + state.color） ---------- */
  function render() {
    return new Promise(function (resolve, reject) {
      var size = 280;
      var ctx = canvas.getContext("2d");
      QRCodeLite.toCanvas(canvas, state.text, {
        width: size,
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: state.color, light: "#ffffff" }
      }, function (err) {
        if (err) { reject(err); return; }
        composeLogo(ctx, size).then(resolve);
      });
    });
  }

  /* ---------- 首次生成 ---------- */
  function generate() {
    var text = linkInput.value.trim();
    if (!text) {
      toast("请先输入链接或文本内容", true);
      linkInput.focus();
      return;
    }
    state.text = text;
    genBtn.disabled = true;
    genBtn.textContent = "生成中...";

    render().then(function () {
      placeholder.style.display = "none";
      canvas.style.display = "block";
      colorPanel.classList.add("show");
      downloadBtn.classList.add("show");
      state.generated = true;
      genBtn.disabled = false;
      genBtn.textContent = "⚡ 重新生成";
      toast("二维码生成成功 🎉");
    }).catch(function (err) {
      toast("生成失败：" + err.message, true);
      genBtn.disabled = false;
      genBtn.textContent = "⚡ 生成二维码";
    });
  }

  /* ---------- 选色后实时重绘 ---------- */
  function applyColor() {
    if (!state.generated) return;
    render().catch(function (err) {
      toast("重绘失败：" + err.message, true);
    });
  }

  genBtn.addEventListener("click", generate);
  linkInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") generate();
  });

  /* ---------- 取色器：拖动 / 选定即时生效 ---------- */
  colorPicker.addEventListener("input", function () {
    state.color = colorPicker.value;
    clearActive();
    applyColor();
  });

  /* ---------- 下载 / 保存 ---------- */
  function downloadCanvas() {
    if (canvas.style.display === "none") return;
    var link = document.createElement("a");
    link.download = "qrcode-" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast("已开始下载 ⬇️");
  }
  downloadBtn.addEventListener("click", downloadCanvas);

  /* ---------- 初始化 ---------- */
  renderColors();
})();
