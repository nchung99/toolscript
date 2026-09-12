
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const DEFAULT_SCORE_GUIDES = {
  10: "Chủ động phát biểu, tập trung xuyên suốt; hiểu bài rất tốt và có sự sáng tạo.",
  9: "Tập trung, chủ động; hiểu đầy đủ nội dung, chỉ còn một vài lỗi nhỏ.",
  8: "Theo dõi bài và tham gia; hiểu phần lớn nội dung và hoàn thành các yêu cầu chính.",
  7: "Theo dõi bài nhưng ít tương tác; cần giáo viên gợi ý nhiều hơn.",
  6: "Dễ mất tập trung; nắm được một phần nội dung và cần luyện tập thêm.",
  5: "Ít hợp tác hoặc ít tham gia hoạt động; cần cải thiện thái độ học tập."
};

const COMMENT_VARIANT_COUNT = 6;

const DEFAULT_BASE_PROMPT = `Bạn là giáo viên dạy trẻ em.
Viết nhận xét sau buổi học bằng tiếng Việt, ngắn gọn và tự nhiên như giáo viên ghi trực tiếp cho phụ huynh.
Dùng câu đơn giản, cụ thể, không sáo rỗng, không dùng cách diễn đạt kiểu báo cáo hoặc quá trang trọng.
Không khen quá mức và không giải thích dài dòng.
Mỗi nhận xét phải có đúng placeholder {name} để thay bằng tên học sinh.
Không tự bịa thông tin không có trong mô tả buổi học.`;

const state = {
  comments: {},
  currentScript: "",
};

const FREE_GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), 1800);
}

function esc(s=""){
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function config(){
  const guides = {};
  for(let s=5;s<=10;s++) guides[s] = $(`#scoreGuide${s}`)?.value || DEFAULT_SCORE_GUIDES[s];
  return {
    modelName: $("#modelName").value,
    variation: $("#variation").value,
    commentLength: $("#commentLength").value,
    tone: $("#tone").value,
    defaultScore: Math.max(5,Math.min(10,Number($("#defaultScore").value)||8)),
    mustCoverAll: $("#mustCoverAll").checked,
    allowEmoji: $("#allowEmoji").checked,
    banGeneric: $("#banGeneric").checked,
    onlyPresent: $("#onlyPresent").checked,
    autoSend: $("#autoSend").checked,
    basePrompt: $("#basePrompt").value.trim() || DEFAULT_BASE_PROMPT,
    scoreGuides: guides
  };
}

function saveConfig(){
  const c = config();
  localStorage.setItem("kapla_ai_config", JSON.stringify(c));
  updateApiStatus();
}

function loadConfig(){
  const saved = JSON.parse(localStorage.getItem("kapla_ai_config") || "null");
  $("#basePrompt").value = saved?.basePrompt || DEFAULT_BASE_PROMPT;
  const savedModel = saved?.modelName;
  $("#modelName").value = FREE_GEMINI_MODELS.includes(savedModel) ? savedModel : "gemini-3.6-flash";
  $("#variation").value = saved?.variation || "medium";
  $("#commentLength").value = saved?.commentLength || "medium";
  $("#tone").value = saved?.tone || "natural";
  $("#defaultScore").value = String(saved?.defaultScore ?? 8);
  $("#mustCoverAll").checked = saved?.mustCoverAll ?? true;
  $("#allowEmoji").checked = saved?.allowEmoji ?? false;
  $("#banGeneric").checked = saved?.banGeneric ?? true;
  $("#onlyPresent").checked = saved?.onlyPresent ?? true;
  $("#autoSend").checked = saved?.autoSend ?? false;
}

function renderScoreConfig(){
  const saved = JSON.parse(localStorage.getItem("kapla_ai_config") || "null");
  const box = $("#scoreConfigGrid");
  box.innerHTML = "";
  [10,9,8,7,6,5].forEach(score=>{
    const wrap = document.createElement("div");
    wrap.className = "field";
    wrap.innerHTML = `<label>Mô tả điểm ${score}</label><textarea id="scoreGuide${score}">${esc(saved?.scoreGuides?.[score] || DEFAULT_SCORE_GUIDES[score])}</textarea>`;
    box.appendChild(wrap);
  });
}

function renderRubric(){
  $("#rubricGrid").innerHTML = [10,9,8,7,6,5].map(s=>
    `<div class="rubric-item"><b>${s}</b><span>${esc(DEFAULT_SCORE_GUIDES[s])}</span></div>`
  ).join("");
}

function renderComments(){
  const score = Number(config().defaultScore);
  const title = $("#resultScoreLine");
  const wrap = $("#commentVariants");

  if (title) title.textContent = `NHẬN XÉT MỨC ĐIỂM ${score}`;
  if (!wrap) return;

  let variants = state.comments[score] || state.comments[String(score)] || [];
  if (!Array.isArray(variants)) variants = variants ? [String(variants)] : [];

  wrap.innerHTML = "";

  if (!variants.length) {
    const empty = document.createElement("div");
    empty.className = "variant-empty";
    empty.textContent = "Chưa có nhận xét. Bấm “Sinh nhận xét bằng AI” để tạo.";
    wrap.appendChild(empty);
    return;
  }

  variants.forEach((text, index)=>{
    const item = document.createElement("div");
    item.className = "variant-item";

    const head = document.createElement("div");
    head.className = "variant-head";
    head.innerHTML = `<span>Cách ${index + 1}</span><small>Luân phiên theo học sinh</small>`;

    const area = document.createElement("textarea");
    area.className = "variant-text";
    area.value = text;
    area.dataset.score = String(score);
    area.dataset.variant = String(index);
    area.addEventListener("input", ()=>{
      if (!Array.isArray(state.comments[score])) state.comments[score] = [];
      state.comments[score][index] = area.value;
    });

    item.appendChild(head);
    item.appendChild(area);
    wrap.appendChild(item);
  });
}

function updateApiStatus(){
  // API key nằm ở backend Vercel.
}

function buildPrompt(lesson){
  const c = config();
  const score = Number(c.defaultScore);
  const lengthText = {short:"1 câu ngắn",medium:"1–2 câu ngắn",long:"2–3 câu ngắn"}[c.commentLength];
  const toneText = {natural:"tự nhiên, gần gũi như giáo viên",encouraging:"khuyến khích tích cực",formal:"lịch sự, chuyên nghiệp"}[c.tone];
  const variationText = {low:"cấu trúc tương đối đồng nhất",medium:"khác nhau vừa phải",high:"khác nhau rõ rệt về cách diễn đạt"}[c.variation];

  return `${c.basePrompt}

MÔ TẢ BUỔI HỌC:
${lesson}

MỨC ĐIỂM ĐANG CẤU HÌNH: ${score}
TIÊU CHÍ ĐIỂM ${score}:
${c.scoreGuides[score]}

YÊU CẦU:
- CHỈ tạo nhận xét cho điểm ${score}. Không tạo điểm khác.
- Viết đúng ${COMMENT_VARIANT_COUNT} cách nhận xét khác nhau cho điểm ${score}.
- Các cách phải khác nhau rõ về câu chữ/cách mở đầu, nhưng cùng đúng tiêu chí điểm ${score}.
- Ưu tiên câu nói tự nhiên kiểu giáo viên: "hôm nay", "trong buổi học", "con đã...".
- Không dùng các cụm quá AI như "cho thấy sự tiến bộ", "thể hiện khả năng", "nắm bắt tốt", "phát huy", "tiếp tục duy trì", trừ khi thật sự cần.
- Không liệt kê dài các nội dung đã học. Chỉ nhắc 1–2 ý tiêu biểu.
- Mỗi nhận xét phải có {name} đúng 1 lần.
- Không tự bịa tên học sinh.
- Độ dài: ${lengthText}.
- Giọng văn: ${toneText}.
- Mức độ khác biệt: ${variationText}.
- ${c.mustCoverAll ? "Phải nhắc tới đầy đủ các hoạt động/mục tiêu chính trong mô tả." : "Chỉ cần nhắc nội dung tiêu biểu."}
- ${c.allowEmoji ? "Có thể dùng emoji vừa phải." : "Không dùng emoji."}
- ${c.banGeneric ? 'Hạn chế các từ quá chung chung như "quy trình", "tổng thể", "nền tảng".' : "Có thể dùng từ khái quát khi cần."}

Chỉ trả về JSON hợp lệ, không markdown, đúng dạng:
{"${score}":["nhận xét 1","nhận xét 2","nhận xét 3","nhận xét 4","nhận xét 5","nhận xét 6"]}`;
}

async function callGemini(prompt){
  const c = config();
  $("#generateHint").textContent = "Đang tạo nhận xét qua backend...";

  let res;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        prompt,
        model: c.modelName,
        variation: c.variation
      })
    });
  } catch (_) {
    throw new Error("Không kết nối được backend. Hãy mở bản đã deploy trên Vercel.");
  }

  let data = {};
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) throw new Error(data?.error || `Backend lỗi HTTP ${res.status}`);
  if (!data?.text) throw new Error("Backend không trả về nội dung AI.");

  return { text: data.text, model: data.model || c.modelName };
}

function parseAiJson(text){
  let clean = text.trim()
    .replace(/^```json\s*/i,"")
    .replace(/^```\s*/,"")
    .replace(/\s*```$/,"");

  const obj = JSON.parse(clean);
  const score = Number(config().defaultScore);
  const value = obj[String(score)] ?? obj[score];

  let variants = [];
  if (Array.isArray(value)) {
    variants = value.map(v => String(v || "").trim()).filter(Boolean);
  } else if (typeof value === "string" && value.trim()) {
    variants = [value.trim()];
  }

  if (!variants.length) {
    throw new Error(`Gemini không trả về nhận xét cho điểm ${score}.`);
  }

  return { [score]: variants.slice(0, COMMENT_VARIANT_COUNT) };
}

function fallbackComments(){
  const lesson = $("#lessonDescription").value.trim() || "nội dung buổi học";
  const short = lesson.replace(/\s+/g," ").slice(0,180);
  const c = config();
  const score = Number(c.defaultScore);
  const guide = c.scoreGuides[score];
  const lower = guide.charAt(0).toLowerCase() + guide.slice(1);

  return {
    [score]: [
      `{name} trong buổi học về ${short}, ${lower}`,
      `Trong buổi học về ${short}, {name} ${lower}`,
      `{name} đã tham gia buổi học về ${short}. ${guide}`,
      `Ở nội dung ${short}, {name} ${lower}`,
      `Qua buổi học về ${short}, {name} cho thấy ${lower}`,
      `{name} đã hoàn thành buổi học về ${short} với mức độ: ${lower}`
    ]
  };
}

async function generateAI(){
  const lesson = $("#lessonDescription").value.trim();
  if(!lesson){ toast("Nhập mô tả buổi học trước."); return; }
  const btn = $("#generateAiBtn");
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "⏳ AI đang sinh nhận xét...";
  $("#generateHint").textContent = "Đang gửi yêu cầu tới Gemini...";
  try{
    saveConfig();
    const result = await callGemini(buildPrompt(lesson));
    state.comments = parseAiJson(result.text);
    renderComments();
    addHistory(lesson, state.comments, `AI · ${result.model}`);
    $("#generateHint").textContent = `Đã sinh nhận xét bằng ${result.model}.`;
    toast(`Đã sinh bằng ${result.model}.`);
  }catch(e){
    console.error(e);
    $("#generateHint").textContent = `Lỗi AI: ${e.message}`;
    toast("AI lỗi, xem thông báo bên dưới.");
  }finally{
    btn.disabled = false; btn.textContent = old;
  }
}

function addHistory(lesson, comments, source="AI"){
  const arr = JSON.parse(localStorage.getItem("kapla_ai_history")||"[]");
  arr.unshift({id:Date.now(), lesson, comments, source, time:new Date().toISOString()});
  localStorage.setItem("kapla_ai_history", JSON.stringify(arr.slice(0,50)));
}

function renderHistory(){
  const q = $("#historySearch").value.trim().toLowerCase();
  const arr = JSON.parse(localStorage.getItem("kapla_ai_history")||"[]")
    .filter(x=>!q || x.lesson.toLowerCase().includes(q) || JSON.stringify(x.comments).toLowerCase().includes(q));

  $("#historyList").innerHTML = arr.length ? arr.map(x=>`
    <div class="history-item" data-id="${x.id}">
      <div class="history-title">${esc(x.lesson.slice(0,120))}</div>
      <div class="history-meta">${new Date(x.time).toLocaleString("vi-VN")} · ${esc(x.source)}</div>
    </div>`).join("") : `<div class="muted" style="padding:18px 0">Chưa có nhận xét nào.</div>`;

  $$("#historyList .history-item").forEach(el=>el.onclick=()=>{
    const x = arr.find(i=>String(i.id)===el.dataset.id);
    if(!x)return;
    $("#lessonDescription").value = x.lesson;
    state.comments = x.comments;
    renderComments();
    switchTab("create");
    toast("Đã nạp lại nhận xét.");
  });
}

function buildEmsScript(){
  syncCommentsFromUi();
  const c = config();
  const selectedScore = Number(c.defaultScore);
  let selectedComments = state.comments[selectedScore] || state.comments[String(selectedScore)] || [];
  if (!Array.isArray(selectedComments)) selectedComments = selectedComments ? [String(selectedComments)] : [];
  const comments = { [selectedScore]: selectedComments.filter(Boolean) };

  return `(() => {
  const COMMENTS = ${JSON.stringify(comments,null,2)};
  const DEFAULT_SCORE = ${c.defaultScore};
  const ONLY_PRESENT = ${c.onlyPresent};

  const rows = [...document.querySelectorAll("table.list-student tbody tr")];
  const readyToSend = [];
  let filled = 0, skipped = 0, commentIndex = 0;
  let stopped = false;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const setValue = (el, value) => {
    if (!el) return;
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const getAttendance = row => row.querySelector(".attendance_type")?.value?.trim() || "";

  const getStudentName = row => {
    const direct = row.querySelector(".student_name")?.innerText?.trim();
    if (direct) return direct;
    const cells = [...row.querySelectorAll("td")];
    const candidate = cells.find(td =>
      /student|học viên|hoc vien|name/i.test(
        (td.className || "") + " " + (td.getAttribute("data-title") || "")
      )
    );
    return candidate?.innerText?.trim() || "";
  };

  const getShortName = fullName => {
    const parts = String(fullName || "").replace(/\\s+/g, " ").trim().split(" ").filter(Boolean);
    return parts.length >= 2 ? parts.slice(-2).join(" ") : String(fullName || "").trim();
  };

  const personalizeComment = (comment, studentName) => {
    if (!studentName) return comment;
    const shortName = getShortName(studentName);
    if (comment.includes("{name}")) return comment.replaceAll("{name}", shortName);
    const trimmed = comment.trim();
    if (/^(con|em|bạn)\\b/i.test(trimmed)) {
      return trimmed.replace(/^(con|em|bạn)\\b/i, shortName);
    }
    return shortName + ", " + trimmed;
  };

  const getScoreInput = row =>
    row.querySelector(".homework_score") ||
    [...row.querySelectorAll("input")].find(el =>
      /score|điểm/i.test((el.name || "") + " " + (el.className || "") + " " + (el.placeholder || ""))
    );

  const getTeacherComment = row => {
    const direct = row.querySelector(
      ".teacher_comment, .comment_teacher, textarea[name*='teacher'], textarea[name*='comment']"
    );
    if (direct) return direct;
    const areas = [...row.querySelectorAll("textarea")];
    return areas[1] || areas[0] || null;
  };

  const getSendButton = row => {
    return [...row.querySelectorAll("button,input[type='button'],input[type='submit']")]
      .find(b => /gửi|send/i.test((b.innerText || b.value || "").trim())) || null;
  };

  rows.forEach((row, index) => {
    const attendance = getAttendance(row);

    // P = Có mặt, L = Đi trễ nhưng vẫn có học.
    if (ONLY_PRESENT && !["P","L"].includes(attendance)) {
      skipped++;
      return;
    }

    const studentName = getStudentName(row);
    const scoreInput = getScoreInput(row);
    const commentBox = getTeacherComment(row);
    const sendButton = getSendButton(row);

    if (!commentBox) {
      console.warn("Không tìm thấy ô nhận xét ở dòng", index + 1);
      skipped++;
      return;
    }

    if (scoreInput) setValue(scoreInput, String(DEFAULT_SCORE));

    const pool = COMMENTS[DEFAULT_SCORE] || COMMENTS[String(DEFAULT_SCORE)] || [];
    const variants = Array.isArray(pool) ? pool : [pool];
    const rawComment = variants.length ? variants[commentIndex % variants.length] : "";
    commentIndex++;

    setValue(commentBox, personalizeComment(rawComment, studentName));

    if (sendButton) {
      sendButton.style.outline = "3px solid #16c784";
      sendButton.style.outlineOffset = "1px";
      readyToSend.push({ button: sendButton, name: studentName });
    }

    filled++;
  });

  document.getElementById("kapla-send-panel")?.remove();

  const panel = document.createElement("div");
  panel.id = "kapla-send-panel";
  panel.style.cssText =
    "position:fixed;top:110px;right:20px;z-index:999999;width:360px;" +
    "background:#fff;border:1px solid #ddd;border-radius:14px;" +
    "box-shadow:0 12px 35px rgba(0,0,0,.2);font-family:Arial,sans-serif;overflow:hidden;";

  panel.innerHTML =
    '<div style="padding:15px 18px;background:#10a9c4;color:#fff;font-size:18px;font-weight:700;">🤖 Nhận Xét Theo Điểm</div>' +
    '<div style="padding:16px;">' +
      '<div id="kapla-send-status" style="padding:11px 12px;border-radius:9px;background:#daf7e8;color:#16744c;font-weight:700;">' +
        '✅ Đã điền ' + filled + ' học sinh có mặt. Sẵn sàng gửi!' +
      '</div>' +
      '<div style="height:7px;background:#e5e8ec;border-radius:99px;margin:14px 0;overflow:hidden;">' +
        '<div id="kapla-send-progress" style="height:100%;width:0%;background:#0db3cf;"></div>' +
      '</div>' +
      '<div style="display:flex;gap:10px;">' +
        '<button id="kapla-stop-btn" style="flex:1;padding:10px;border:1px solid #ccd2d9;border-radius:8px;background:#fff;font-weight:700;cursor:pointer;">Ⅱ Dừng</button>' +
        '<button id="kapla-send-btn" style="flex:1;padding:10px;border:0;border-radius:8px;background:#16bd7b;color:#fff;font-weight:700;cursor:pointer;">✅ Gửi</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(panel);

  const status = panel.querySelector("#kapla-send-status");
  const progress = panel.querySelector("#kapla-send-progress");
  const sendAll = panel.querySelector("#kapla-send-btn");
  const stop = panel.querySelector("#kapla-stop-btn");

  if (!readyToSend.length) {
    status.textContent = "Không có học sinh có mặt để gửi.";
    status.style.background = "#fff0d8";
    status.style.color = "#8b5b12";
    sendAll.disabled = true;
    sendAll.style.opacity = ".5";
  }

  stop.onclick = () => {
    stopped = true;
    status.textContent = "⏸ Đã dừng.";
  };

  sendAll.onclick = async () => {
    stopped = false;
    sendAll.disabled = true;

    for (let i = 0; i < readyToSend.length; i++) {
      if (stopped) break;

      const item = readyToSend[i];
      status.textContent =
        "Đang gửi " + (i + 1) + "/" + readyToSend.length +
        (item.name ? ": " + getShortName(item.name) : "");

      item.button.click();
      progress.style.width = Math.round(((i + 1) / readyToSend.length) * 100) + "%";
      await sleep(900);
    }

    if (stopped) {
      sendAll.disabled = false;
      return;
    }

    status.textContent = "✅ Đã gửi xong " + readyToSend.length + " học sinh có mặt.";
    progress.style.width = "100%";
    sendAll.disabled = false;
  };

  console.log("KAPLA Tool: đã điền " + filled + " học viên, bỏ qua " + skipped + ".");
})();`;
}

function syncCommentsFromUi(){
  const score = Number(config().defaultScore);
  const areas = [...document.querySelectorAll(".variant-text")];
  if (!areas.length) return;
  state.comments[score] = areas
    .map(a=>a.value.trim())
    .filter(Boolean);
}

function createScript(){
  syncCommentsFromUi();
  const score = Number(config().defaultScore);
  const variants = state.comments[score] || state.comments[String(score)] || [];

  if (!Array.isArray(variants) || !variants.filter(Boolean).length) {
    toast(`Chưa có nhận xét cho mức điểm ${score}.`);
    return;
  }

  state.currentScript = buildEmsScript();
  $("#scriptOutput").textContent = state.currentScript;
  switchTab("script");
  toast(`Đã tạo script cho mức điểm ${score}.`);
}

function switchTab(id){
  $$(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===id));
  $$(".panel").forEach(p=>p.classList.toggle("active", p.id===id));
  if(id==="history") renderHistory();
  if(id==="auto") renderAuto();
}

function exportConfig(){
  saveConfig();
  const blob = new Blob([localStorage.getItem("kapla_ai_config")],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download="kapla-ai-config.json";a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

function resetConfig(){
  localStorage.removeItem("kapla_ai_config");
  renderScoreConfig(); loadConfig(); updateApiStatus(); toast("Đã khôi phục mặc định.");
}

async function importConfig(file){
  const text = await file.text();
  const obj = JSON.parse(text);
  localStorage.setItem("kapla_ai_config", JSON.stringify(obj));
  renderScoreConfig(); loadConfig(); updateApiStatus(); toast("Đã nhập cấu hình.");
}

async function saveAuto(){
  const name=$("#autoName").value.trim();
  const desc=$("#autoDescription").value.trim();
  if(!name||!desc){toast("Nhập tên và mô tả mẫu.");return;}
  const arr=JSON.parse(localStorage.getItem("kapla_auto_templates")||"[]");
  const tpl={id:Date.now(),name,desc,lastRun:null,nextRun:new Date().toISOString()};
  arr.unshift(tpl);
  localStorage.setItem("kapla_auto_templates",JSON.stringify(arr));
  $("#autoName").value="";$("#autoDescription").value="";
  await runAutoTemplate(tpl.id);
  renderAuto();
}

async function runAutoTemplate(id){
  const templates=JSON.parse(localStorage.getItem("kapla_auto_templates")||"[]");
  const tpl=templates.find(x=>x.id===id); if(!tpl)return;
  try{
    const result=await callGemini(buildPrompt(tpl.desc));
    const comments=parseAiJson(result.text);
    const now=new Date();
    const next=new Date(now); next.setMonth(next.getMonth()+1);
    tpl.lastRun=now.toISOString();tpl.nextRun=next.toISOString();
    localStorage.setItem("kapla_auto_templates",JSON.stringify(templates));
    const hist=JSON.parse(localStorage.getItem("kapla_auto_history")||"[]");
    hist.unshift({id:Date.now(),templateId:id,name:tpl.name,desc:tpl.desc,comments,time:now.toISOString()});
    localStorage.setItem("kapla_auto_history",JSON.stringify(hist.slice(0,100)));
    toast("Đã chạy AI cho mẫu.");
  }catch(e){toast("Auto AI lỗi: "+e.message);}
}

function renderAuto(){
  const tpls=JSON.parse(localStorage.getItem("kapla_auto_templates")||"[]");
  const hist=JSON.parse(localStorage.getItem("kapla_auto_history")||"[]");
  const now=Date.now();
  const due=tpls.filter(x=>!x.nextRun || new Date(x.nextRun).getTime()<=now);
  $("#templateCount").textContent=tpls.length;
  $("#dueCount").textContent=due.length;
  $("#autoHistoryCount").textContent=hist.length;

  $("#autoTemplateList").innerHTML=tpls.length?tpls.map(x=>`
    <div class="auto-item">
      <b>${esc(x.name)}</b>
      <div class="muted">${x.lastRun?'Chạy gần nhất: '+new Date(x.lastRun).toLocaleString("vi-VN"):'Chưa chạy'}</div>
      <div class="actions"><button class="btn secondary" onclick="runAutoTemplate(${x.id}).then(renderAuto)">Chạy lại</button><button class="btn danger" onclick="deleteAuto(${x.id})">Xóa</button></div>
    </div>`).join(""):`<div class="muted">Chưa có mẫu nào.</div>`;

  $("#autoHistoryList").innerHTML=hist.length?hist.slice(0,20).map(x=>`
    <div class="auto-item"><b>${esc(x.name)}</b><div class="muted">${new Date(x.time).toLocaleString("vi-VN")}</div></div>`).join(""):`<div class="muted">Chưa có lần chạy tự động.</div>`;
}

window.deleteAuto=(id)=>{
  let arr=JSON.parse(localStorage.getItem("kapla_auto_templates")||"[]").filter(x=>x.id!==id);
  localStorage.setItem("kapla_auto_templates",JSON.stringify(arr));renderAuto();
};
window.runAutoTemplate=runAutoTemplate;
window.renderAuto=renderAuto;

function attachEvents(){
  $$(".tab").forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));
  $("#generateAiBtn").onclick=generateAI;
  $("#demoBtn").onclick=()=>{
    const lesson=$("#lessonDescription").value.trim();
    if(!lesson){toast("Nhập mô tả buổi học trước.");return;}
    state.comments=fallbackComments();renderComments();addHistory(lesson,state.comments,"Mẫu nhanh");toast("Đã tạo nhận xét mẫu.");
  };
  $("#createScriptBtn").onclick=createScript;
  $("#createScriptTopBtn").onclick=createScript;
  $("#copyScriptBtn").onclick=async()=>{
    const txt=$("#scriptOutput").textContent;
    if(txt.startsWith("/* Chưa")) return toast("Chưa có script.");
    await navigator.clipboard.writeText(txt);toast("Đã copy script.");
  };
  $("#clearHistoryBtn").onclick=()=>{
    if(confirm("Xóa toàn bộ lịch sử?")){localStorage.removeItem("kapla_ai_history");renderHistory();}
  };
  $("#historySearch").oninput=renderHistory;
  $("#resetConfigBtn").onclick=resetConfig;
  $("#exportConfigBtn").onclick=exportConfig;
  $("#importConfigInput").onchange=e=>e.target.files[0]&&importConfig(e.target.files[0]).catch(err=>toast("File cấu hình lỗi: "+err.message));
  $("#saveAutoBtn").onclick=saveAuto;

  ["modelName","variation","commentLength","tone","mustCoverAll","allowEmoji","banGeneric","onlyPresent","autoSend","basePrompt"]
    .forEach(id=>$("#"+id).addEventListener("change",saveConfig));

  const defaultScoreEl = $("#defaultScore");
  defaultScoreEl.addEventListener("change",()=>{
    saveConfig();
    state.comments = {};
    renderComments();
    $("#generateHint").textContent =
      `Đang chọn mức điểm ${defaultScoreEl.value}. Bấm “Sinh nhận xét bằng AI” để tạo nhận xét mới.`;
  });

  document.addEventListener("input",e=>{
    if(/^scoreGuide\d+$/.test(e.target.id)) saveConfig();
  });
}

renderRubric();
renderScoreConfig();
loadConfig();
renderComments();
attachEvents();
updateApiStatus();
renderAuto();
