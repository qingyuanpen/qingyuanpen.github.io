(() => {
  "use strict";

  const STORAGE_KEY = "guanqingEnglishCheckin.v1";
  const TASKS = [
    { key: "vocabulary", label: "词汇" },
    { key: "listening", label: "Listening" },
    { key: "ielts", label: "IELTS" },
    { key: "paper", label: "论文" },
    { key: "speaking", label: "口语 / 跟读" },
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const today = new Date();
  const todayKey = toDateKey(today);
  let selectedDate = todayKey;
  let calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1);
  let audioMeta = { fileName: "", durationSeconds: 0 };
  let currentAudioUrl = "";
  let recorder = null;
  let recorderStream = null;
  let recorderChunks = [];
  let recorderTimer = null;
  let recordingStartedAt = 0;
  let toastTimer = null;

  const state = loadState();

  function emptyEntry() {
    return {
      vocabulary: { done: false, newWords: 0, reviewedWords: 0 },
      listening: { done: false, material: "", section: "" },
      ielts: { done: false, task: "Reading", note: "" },
      paper: { done: false, mode: "摘要", title: "", insight: "" },
      speaking: { done: false, fileName: "", durationSeconds: 0 },
      updatedAt: "",
    };
  }

  function normalizeEntry(value) {
    const fallback = emptyEntry();
    if (!value || typeof value !== "object") return fallback;
    return {
      vocabulary: { ...fallback.vocabulary, ...(value.vocabulary || {}) },
      listening: { ...fallback.listening, ...(value.listening || {}) },
      ielts: { ...fallback.ielts, ...(value.ielts || {}) },
      paper: { ...fallback.paper, ...(value.paper || {}) },
      speaking: { ...fallback.speaking, ...(value.speaking || {}) },
      updatedAt: value.updatedAt || "",
    };
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && stored.version === 1 && stored.entries) {
        return {
          version: 1,
          theme: stored.theme || "",
          entries: stored.entries,
        };
      }
    } catch (error) {
      console.warn("Unable to read saved check-ins", error);
    }
    return { version: 1, theme: "", entries: {} };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      showToast("浏览器存储空间不足，这次修改可能无法保存。");
    }
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDate(dateKey) {
    return new Date(`${dateKey}T12:00:00`);
  }

  function addDays(dateKey, amount) {
    const date = parseDate(dateKey);
    date.setDate(date.getDate() + amount);
    return toDateKey(date);
  }

  function daysBetween(startKey, endKey) {
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.round((parseDate(endKey) - parseDate(startKey)) / oneDay);
  }

  function formatDate(dateKey, style = "long") {
    const date = parseDate(dateKey);
    if (style === "card") {
      return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
    }
    if (style === "monthDay") {
      return `${date.getMonth() + 1}月${date.getDate()}日`;
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(date);
  }

  function getEntry(dateKey) {
    return normalizeEntry(state.entries[dateKey]);
  }

  function hasActivity(entry) {
    return TASKS.some(({ key }) => Boolean(entry[key].done));
  }

  function completedCount(entry) {
    return TASKS.reduce((total, { key }) => total + (entry[key].done ? 1 : 0), 0);
  }

  function activeDates() {
    return Object.entries(state.entries)
      .filter(([, value]) => hasActivity(normalizeEntry(value)))
      .map(([dateKey]) => dateKey)
      .sort();
  }

  function dayNumber(dateKey) {
    const dates = activeDates();
    if (!dates.length) return 1;
    const firstDate = dates[0] < dateKey ? dates[0] : dateKey;
    return Math.max(1, daysBetween(firstDate, dateKey) + 1);
  }

  function streakEndingAt(dateKey) {
    if (!hasActivity(getEntry(dateKey))) return 0;
    let count = 0;
    let cursor = dateKey;
    while (hasActivity(getEntry(cursor))) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  function currentStreak() {
    const start = hasActivity(getEntry(todayKey)) ? todayKey : addDays(todayKey, -1);
    return streakEndingAt(start);
  }

  function setForm(entry) {
    $("#vocabularyDone").checked = entry.vocabulary.done;
    $("#newWords").value = entry.vocabulary.newWords || 0;
    $("#reviewedWords").value = entry.vocabulary.reviewedWords || 0;

    $("#listeningDone").checked = entry.listening.done;
    $("#listeningMaterial").value = entry.listening.material || "";
    $("#listeningSection").value = entry.listening.section || "";

    $("#ieltsDone").checked = entry.ielts.done;
    const selectedTask = $(`input[name="ieltsTask"][value="${entry.ielts.task || "Reading"}"]`);
    if (selectedTask) selectedTask.checked = true;
    $("#ieltsNote").value = entry.ielts.note || "";

    $("#paperDone").checked = entry.paper.done;
    $("#paperMode").value = entry.paper.mode || "摘要";
    $("#paperTitle").value = entry.paper.title || "";
    $("#paperInsight").value = entry.paper.insight || "";

    $("#speakingDone").checked = entry.speaking.done;
    audioMeta = {
      fileName: entry.speaking.fileName || "",
      durationSeconds: Number(entry.speaking.durationSeconds) || 0,
    };
    renderAudioSummary(false);
  }

  function readForm() {
    const selectedIelts = $('input[name="ieltsTask"]:checked');
    return {
      vocabulary: {
        done: $("#vocabularyDone").checked,
        newWords: clampNumber($("#newWords").value, 0, 999),
        reviewedWords: clampNumber($("#reviewedWords").value, 0, 9999),
      },
      listening: {
        done: $("#listeningDone").checked,
        material: $("#listeningMaterial").value.trim(),
        section: $("#listeningSection").value.trim(),
      },
      ielts: {
        done: $("#ieltsDone").checked,
        task: selectedIelts ? selectedIelts.value : "Reading",
        note: $("#ieltsNote").value.trim(),
      },
      paper: {
        done: $("#paperDone").checked,
        mode: $("#paperMode").value,
        title: $("#paperTitle").value.trim(),
        insight: $("#paperInsight").value.trim(),
      },
      speaking: {
        done: $("#speakingDone").checked,
        fileName: audioMeta.fileName,
        durationSeconds: audioMeta.durationSeconds,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  function clampNumber(value, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function saveCurrentEntry() {
    state.entries[selectedDate] = readForm();
    saveState();
    renderDerived();
  }

  function renderSelectedDate() {
    $("#entryDate").value = selectedDate;
    $("#nextDate").disabled = selectedDate >= todayKey;
    revokeCurrentAudioUrl();
    setForm(getEntry(selectedDate));
    renderDerived();
  }

  function taskDetail(entry, key) {
    if (key === "vocabulary") {
      return `新词 ${entry.vocabulary.newWords || 0} · 复习 ${entry.vocabulary.reviewedWords || 0}`;
    }
    if (key === "listening") {
      return [entry.listening.material, entry.listening.section].filter(Boolean).join(" · ") || "等待记录材料";
    }
    if (key === "ielts") {
      return [entry.ielts.task, entry.ielts.note].filter(Boolean).join(" · ");
    }
    if (key === "paper") {
      return [entry.paper.mode, entry.paper.title].filter(Boolean).join(" · ") || "等待记录题目";
    }
    const duration = entry.speaking.durationSeconds ? formatDuration(entry.speaking.durationSeconds) : "";
    return [entry.speaking.fileName, duration].filter(Boolean).join(" · ") || "等待添加录音";
  }

  function renderDerived() {
    const entry = getEntry(selectedDate);
    const done = completedCount(entry);
    const percent = Math.round((done / TASKS.length) * 100);
    const selectedStreak = streakEndingAt(selectedDate);

    TASKS.forEach(({ key }) => {
      $(`[data-task-card="${key}"]`).classList.toggle("is-done", entry[key].done);
    });

    $("#formProgress").textContent = `${percent}%`;
    $("#formProgressDetail").textContent = `${done} / ${TASKS.length} 项已点亮`;
    $("#headerStreak").textContent = `连续 ${currentStreak()} 天`;
    $("#previewDay").textContent = `Day ${String(dayNumber(selectedDate)).padStart(3, "0")}`;
    $("#previewProgress").textContent = `${percent}%`;
    $("#previewProgressRing").style.setProperty("--progress", `${percent * 3.6}deg`);
    $("#previewStreak").textContent = `${selectedStreak} day streak`;
    $("#previewDate").textContent = `冠清英语打卡 · ${formatDate(selectedDate, "card")}`;

    const list = $("#previewTaskList");
    list.replaceChildren();
    TASKS.forEach(({ key, label }) => {
      const row = document.createElement("div");
      row.className = `share-task-row${entry[key].done ? " is-done" : ""}`;
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("strong");
      name.textContent = label;
      const detail = document.createElement("span");
      detail.textContent = taskDetail(entry, key);
      row.append(dot, name, detail);
      list.append(row);
    });

    if (!$("#statsView").hidden) renderStats();
    if (!$("#galleryView").hidden) renderGallery();
  }

  function switchView(name, updateHash = true) {
    const validName = ["today", "stats", "gallery"].includes(name) ? name : "today";
    $$("[data-view]").forEach((view) => {
      const active = view.dataset.view === validName;
      view.hidden = !active;
      view.classList.toggle("is-active", active);
    });
    $$("[data-view-target]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.viewTarget === validName);
      button.setAttribute("aria-current", button.dataset.viewTarget === validName ? "page" : "false");
    });
    if (validName === "stats") renderStats();
    if (validName === "gallery") renderGallery();
    if (updateHash) history.replaceState(null, "", `#${validName}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderStats() {
    const entries = activeDates().map((dateKey) => [dateKey, getEntry(dateKey)]);
    const totals = entries.reduce(
      (result, [, entry]) => {
        result.newWords += Number(entry.vocabulary.newWords) || 0;
        result.reviewedWords += Number(entry.vocabulary.reviewedWords) || 0;
        result.speakingSeconds += Number(entry.speaking.durationSeconds) || 0;
        return result;
      },
      { newWords: 0, reviewedWords: 0, speakingSeconds: 0 },
    );

    const stats = [
      { label: "累计打卡", value: `${entries.length} 天`, note: `当前连续 ${currentStreak()} 天` },
      { label: "新词积累", value: totals.newWords.toLocaleString("zh-CN"), note: "按每日实际记录统计" },
      { label: "复习次数", value: totals.reviewedWords.toLocaleString("zh-CN"), note: "重复遇见，才会留下" },
      { label: "口语录音", value: `${Math.round(totals.speakingSeconds / 60)} 分`, note: "上传与现场录音合计" },
    ];

    const grid = $("#statGrid");
    grid.replaceChildren();
    stats.forEach((item) => {
      const card = document.createElement("article");
      card.className = "stat-card";
      const label = document.createElement("span");
      label.textContent = item.label;
      const value = document.createElement("strong");
      value.textContent = item.value;
      const note = document.createElement("small");
      note.textContent = item.note;
      card.append(label, value, note);
      grid.append(card);
    });

    renderCalendar();
    renderModuleBars();
  }

  function renderCalendar() {
    const year = calendarCursor.getFullYear();
    const month = calendarCursor.getMonth();
    $("#calendarTitle").textContent = `${year}年${month + 1}月`;
    $("#nextMonth").disabled = year === today.getFullYear() && month >= today.getMonth();

    const grid = $("#calendarGrid");
    grid.replaceChildren();
    const firstDayOffset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((firstDayOffset + daysInMonth) / 7) * 7;

    for (let index = 0; index < cellCount; index += 1) {
      const day = index - firstDayOffset + 1;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "calendar-day";
      if (day < 1 || day > daysInMonth) {
        cell.classList.add("is-outside");
        cell.disabled = true;
      } else {
        const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const count = completedCount(getEntry(dateKey));
        cell.textContent = String(day);
        cell.dataset.level = String(count);
        cell.classList.toggle("is-selected", dateKey === selectedDate);
        cell.disabled = dateKey > todayKey;
        cell.setAttribute("aria-label", `${formatDate(dateKey)}，完成 ${count} 项`);
        cell.addEventListener("click", () => {
          selectedDate = dateKey;
          renderSelectedDate();
          switchView("today");
        });
      }
      grid.append(cell);
    }
  }

  function renderModuleBars() {
    const counts = Object.fromEntries(TASKS.map(({ key }) => [key, 0]));
    for (let offset = 0; offset < 7; offset += 1) {
      const entry = getEntry(addDays(todayKey, -offset));
      TASKS.forEach(({ key }) => {
        if (entry[key].done) counts[key] += 1;
      });
    }

    const bars = $("#moduleBars");
    bars.replaceChildren();
    TASKS.forEach(({ key, label }) => {
      const wrapper = document.createElement("div");
      wrapper.className = "module-bar";
      const count = document.createElement("strong");
      count.textContent = `${counts[key]}/7`;
      const bar = document.createElement("i");
      bar.style.height = `${Math.max(3, (counts[key] / 7) * 190)}px`;
      const name = document.createElement("span");
      name.textContent = label;
      wrapper.append(count, bar, name);
      bars.append(wrapper);
    });

    const maximum = Math.max(...Object.values(counts));
    const strongest = TASKS.filter(({ key }) => counts[key] === maximum).map(({ label }) => label);
    $("#moduleInsight").textContent = maximum
      ? `最近七天投入最多的是：${strongest.join("、")}。`
      : "开始打卡后，这里会出现你的学习侧重点。";
  }

  function renderGallery() {
    const dates = activeDates().sort().reverse();
    $("#galleryEmpty").hidden = dates.length > 0;
    const grid = $("#galleryGrid");
    grid.replaceChildren();

    dates.forEach((dateKey) => {
      const entry = getEntry(dateKey);
      const done = completedCount(entry);
      const percent = Math.round((done / TASKS.length) * 100);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gallery-card";
      button.setAttribute("aria-label", `查看 ${formatDate(dateKey)} 的打卡图片`);

      const top = document.createElement("div");
      const kicker = document.createElement("span");
      kicker.className = "share-kicker";
      kicker.textContent = formatDate(dateKey, "card");
      const title = document.createElement("h2");
      title.textContent = `Day ${String(dayNumber(dateKey)).padStart(3, "0")}`;
      const description = document.createElement("p");
      description.textContent = done === TASKS.length ? "完整的一天" : `${done} / ${TASKS.length} · 小步也算数`;
      top.append(kicker, title, description);

      const progress = document.createElement("div");
      progress.className = "gallery-progress";
      const progressFill = document.createElement("i");
      progressFill.style.width = `${percent}%`;
      progress.append(progressFill);

      const foot = document.createElement("div");
      foot.className = "gallery-card-foot";
      const score = document.createElement("strong");
      score.textContent = `${percent}%`;
      const hint = document.createElement("span");
      hint.textContent = "查看打卡图 →";
      foot.append(score, hint);

      button.append(top, progress, foot);
      button.addEventListener("click", () => {
        selectedDate = dateKey;
        renderSelectedDate();
        openCardDialog();
      });
      grid.append(button);
    });
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    state.theme = theme;
    saveState();
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  }

  function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return minutes ? `${minutes}分${String(remainder).padStart(2, "0")}秒` : `${remainder}秒`;
  }

  function renderAudioSummary(playable) {
    const hasFile = Boolean(audioMeta.fileName);
    $("#audioSummary").hidden = !hasFile;
    $("#audioFileName").textContent = audioMeta.fileName || "尚未添加录音";
    $("#audioDuration").textContent = formatDuration(audioMeta.durationSeconds);
    $("#audioPreview").hidden = !playable;
  }

  function revokeCurrentAudioUrl() {
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = "";
    $("#audioPreview").removeAttribute("src");
    $("#saveRecording").hidden = true;
  }

  function useAudioBlob(blob, fileName, allowDownload) {
    revokeCurrentAudioUrl();
    currentAudioUrl = URL.createObjectURL(blob);
    const audio = $("#audioPreview");
    audio.src = currentAudioUrl;
    audio.hidden = false;
    audioMeta.fileName = fileName;
    audio.addEventListener(
      "loadedmetadata",
      () => {
        if (Number.isFinite(audio.duration)) audioMeta.durationSeconds = Math.round(audio.duration);
        renderAudioSummary(true);
        saveCurrentEntry();
      },
      { once: true },
    );
    if (allowDownload) {
      const link = $("#saveRecording");
      link.href = currentAudioUrl;
      link.download = fileName;
      link.hidden = false;
    }
    renderAudioSummary(true);
    saveCurrentEntry();
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showToast("当前浏览器不支持直接录音，请使用上传录音。");
      return;
    }
    try {
      recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderChunks = [];
      recorder = new MediaRecorder(recorderStream);
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) recorderChunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));
        const blob = new Blob(recorderChunks, { type: recorder.mimeType || "audio/webm" });
        audioMeta.durationSeconds = durationSeconds;
        const fileName = `guanqing-speaking-${selectedDate}.webm`;
        useAudioBlob(blob, fileName, true);
        recorderStream?.getTracks().forEach((track) => track.stop());
        recorderStream = null;
        recorder = null;
        window.clearInterval(recorderTimer);
        $("#recordingTime").textContent = formatClock(durationSeconds);
        $("#recordButton").disabled = false;
        $("#stopRecordButton").disabled = true;
        showToast("录音完成，记得保存录音文件。");
      });
      recorder.start();
      recordingStartedAt = Date.now();
      $("#recordButton").disabled = true;
      $("#stopRecordButton").disabled = false;
      $("#recordingTime").textContent = "00:00";
      recorderTimer = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartedAt) / 1000);
        $("#recordingTime").textContent = formatClock(elapsed);
      }, 500);
    } catch (error) {
      showToast("未能使用麦克风，请允许权限或改用上传录音。");
    }
  }

  function stopRecording() {
    if (recorder?.state === "recording") recorder.stop();
  }

  function formatClock(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function drawRoundedRect(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
  }

  function fitCanvasText(context, text, maxWidth, startSize, minSize = 26) {
    let size = startSize;
    while (size > minSize) {
      context.font = `500 ${size}px "Microsoft YaHei", sans-serif`;
      if (context.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    return size;
  }

  function drawCard(dateKey = selectedDate) {
    const canvas = $("#checkinCanvas");
    const context = canvas.getContext("2d");
    const entry = getEntry(dateKey);
    const done = completedCount(entry);
    const percent = Math.round((done / TASKS.length) * 100);
    const width = canvas.width;
    const height = canvas.height;

    context.clearRect(0, 0, width, height);
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#fbf3df");
    background.addColorStop(1, "#dceadd");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(910, 160, 10, 910, 160, 310);
    glow.addColorStop(0, "rgba(232, 153, 87, 0.54)");
    glow.addColorStop(1, "rgba(232, 153, 87, 0)");
    context.fillStyle = glow;
    context.fillRect(600, 0, 480, 480);

    context.strokeStyle = "rgba(36, 87, 66, 0.11)";
    context.lineWidth = 46;
    context.beginPath();
    context.arc(1060, 1390, 190, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = "#17352a";
    context.font = '500 25px Georgia, "Times New Roman", serif';
    context.letterSpacing = "5px";
    context.fillText("DAILY ENGLISH LOG", 86, 103);

    context.font = '500 78px Georgia, "Times New Roman", serif';
    context.fillText(`Day ${String(dayNumber(dateKey)).padStart(3, "0")}`, 82, 205);

    const ringX = 895;
    const ringY = 150;
    const ringRadius = 70;
    context.lineWidth = 22;
    context.strokeStyle = "rgba(36, 87, 66, 0.15)";
    context.beginPath();
    context.arc(ringX, ringY, ringRadius, 0, Math.PI * 2);
    context.stroke();
    if (percent > 0) {
      context.strokeStyle = "#245742";
      context.lineCap = "round";
      context.beginPath();
      context.arc(ringX, ringY, ringRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (percent / 100));
      context.stroke();
      context.lineCap = "butt";
    }
    context.fillStyle = "#17352a";
    context.textAlign = "center";
    context.font = '500 34px Georgia, "Times New Roman", serif';
    context.fillText(`${percent}%`, ringX, ringY + 11);
    context.textAlign = "left";

    context.font = '400 31px Georgia, "Noto Serif SC", serif';
    context.fillText("“Fluency grows quietly,", 84, 315);
    context.fillText("one honest day at a time.”", 84, 360);

    const startY = 435;
    const rowHeight = 142;
    TASKS.forEach(({ key, label }, index) => {
      const y = startY + index * rowHeight;
      context.strokeStyle = "rgba(36, 87, 66, 0.2)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(82, y + rowHeight - 18);
      context.lineTo(998, y + rowHeight - 18);
      context.stroke();

      context.beginPath();
      context.arc(96, y + 38, 9, 0, Math.PI * 2);
      if (entry[key].done) {
        context.fillStyle = "#245742";
        context.fill();
      } else {
        context.strokeStyle = "#245742";
        context.lineWidth = 2;
        context.stroke();
      }

      context.fillStyle = "#17352a";
      context.font = '600 31px "Microsoft YaHei", sans-serif';
      context.fillText(label, 132, y + 49);

      const detail = taskDetail(entry, key);
      const detailSize = fitCanvasText(context, detail, 645, 27, 21);
      context.font = `400 ${detailSize}px "Microsoft YaHei", sans-serif`;
      context.fillStyle = "rgba(23, 53, 42, 0.66)";
      context.fillText(detail, 132, y + 92);
    });

    const streak = streakEndingAt(dateKey);
    context.fillStyle = "#17352a";
    context.font = '500 48px Georgia, "Times New Roman", serif';
    context.fillText(`${streak} day streak`, 82, 1284);
    context.font = '400 21px "Microsoft YaHei", sans-serif';
    context.fillStyle = "rgba(23, 53, 42, 0.66)";
    context.fillText(`冠清英语打卡 · ${formatDate(dateKey, "card")}`, 84, 1328);

    context.strokeStyle = "#245742";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(930, 1270, 58, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#17352a";
    context.textAlign = "center";
    context.font = '500 22px "Microsoft YaHei", sans-serif';
    context.fillText("持续", 930, 1263);
    context.fillText("生长", 930, 1292);
    context.textAlign = "left";
  }

  function openCardDialog() {
    drawCard(selectedDate);
    const dialog = $("#cardDialog");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeCardDialog() {
    const dialog = $("#cardDialog");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function canvasBlob() {
    return new Promise((resolve) => $("#checkinCanvas").toBlob(resolve, "image/png", 1));
  }

  async function downloadCard() {
    drawCard(selectedDate);
    const blob = await canvasBlob();
    if (!blob) {
      showToast("图片生成失败，请稍后重试。");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `冠清英语打卡-${selectedDate}.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("打卡图片已下载。");
  }

  async function shareCard() {
    drawCard(selectedDate);
    const blob = await canvasBlob();
    if (!blob) return;
    const file = new File([blob], `冠清英语打卡-${selectedDate}.png`, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: "冠清英语打卡",
          text: `${formatDate(selectedDate, "monthDay")}，完成 ${completedCount(getEntry(selectedDate))} 项英语学习任务。`,
          files: [file],
        });
      } catch (error) {
        if (error.name !== "AbortError") showToast("分享没有完成，可以改用下载图片。");
      }
    } else {
      showToast("当前浏览器不支持直接分享，已为你下载图片。");
      await downloadCard();
    }
  }

  function exportData() {
    const exportPayload = {
      name: "冠清英语打卡",
      exportedAt: new Date().toISOString(),
      ...state,
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `冠清英语打卡-学习记录-${todayKey}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("学习记录已导出。");
  }

  function bindEvents() {
    $$("[data-view-target]").forEach((button) => {
      button.addEventListener("click", () => switchView(button.dataset.viewTarget));
    });
    $$("[data-go-today]").forEach((button) => button.addEventListener("click", () => switchView("today")));

    $("#themeToggle").addEventListener("click", () => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    });

    $("#checkinForm").addEventListener("input", saveCurrentEntry);
    $("#checkinForm").addEventListener("change", saveCurrentEntry);

    $$('[data-step]').forEach((button) => {
      button.addEventListener("click", () => {
        const input = $(`#${button.dataset.step}`);
        const nextValue = clampNumber(Number(input.value) + Number(button.dataset.delta), Number(input.min), Number(input.max));
        input.value = String(nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    $("#entryDate").max = todayKey;
    $("#entryDate").addEventListener("change", (event) => {
      if (!event.target.value || event.target.value > todayKey) return;
      selectedDate = event.target.value;
      renderSelectedDate();
    });
    $("#previousDate").addEventListener("click", () => {
      selectedDate = addDays(selectedDate, -1);
      renderSelectedDate();
    });
    $("#nextDate").addEventListener("click", () => {
      if (selectedDate < todayKey) selectedDate = addDays(selectedDate, 1);
      renderSelectedDate();
    });

    $("#previousMonth").addEventListener("click", () => {
      calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
      renderCalendar();
    });
    $("#nextMonth").addEventListener("click", () => {
      const next = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
      if (next <= new Date(today.getFullYear(), today.getMonth(), 1)) calendarCursor = next;
      renderCalendar();
    });

    $("#audioUpload").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      useAudioBlob(file, file.name, false);
      event.target.value = "";
    });
    $("#recordButton").addEventListener("click", startRecording);
    $("#stopRecordButton").addEventListener("click", stopRecording);

    $("#openCardButton").addEventListener("click", openCardDialog);
    $("#closeCardDialog").addEventListener("click", closeCardDialog);
    $("#cardDialog").addEventListener("click", (event) => {
      if (event.target === $("#cardDialog")) closeCardDialog();
    });
    $("#downloadImageButton").addEventListener("click", downloadCard);
    $("#shareImageButton").addEventListener("click", shareCard);
    $("#exportDataButton").addEventListener("click", exportData);

    window.addEventListener("hashchange", () => switchView(location.hash.slice(1), false));
    window.addEventListener("beforeunload", () => {
      revokeCurrentAudioUrl();
      recorderStream?.getTracks().forEach((track) => track.stop());
    });
  }

  function initialize() {
    const preferredTheme = state.theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = preferredTheme;
    bindEvents();
    renderSelectedDate();
    switchView(location.hash.slice(1) || "today", false);
  }

  initialize();
})();

