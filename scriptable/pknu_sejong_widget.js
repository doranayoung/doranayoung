// ✅ PKNU 세종기숙사 식단 위젯 (최종 완성형)
// 날짜 기반 + 현재주 우선 파싱 + 누락시 AJAX 로드
// 날짜포맷: 2025-10-27 (월)
// 메뉴: 한 줄 유지, 쉼표 구분
// 제작: ChatGPT with Erica & Gemini

const MAIN_URL = "https://dormitory.pknu.ac.kr/03_notice/notice01.php";
const AJAX_URL = "https://dormitory.pknu.ac.kr/03_notice/req_getSchedule.php";
const BID = "foodE"; // 세종
const KOR_DOW = ["일","월","화","수","목","금","토"];
const EMPTY_LABEL = "제공 없음";

// ---- 오늘 날짜 계산 ----
const now = new Date();
const y = now.getFullYear();
const m = now.getMonth() + 1;
const d = now.getDate();
const dow = KOR_DOW[now.getDay()];
const todayTag = `${m}/${d}`; // ex) "10/27"
const todayLabel = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")} (${dow})`;

// ---- 유틸 ----
function stripTagsToOneLine(s) {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>(\s*)/gi, ", ")
    .replace(/<\/p>\s*<p>/gi, ", ")
    .replace(/<li[^>]*>/gi, "")
    .replace(/<\/li>/gi, ", ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00A0/g, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/[＊*]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*,\s*/g, ", ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim();
}

function isEmptyCell(txt) {
  if (!txt) return true;
  const t = stripTagsToOneLine(txt).trim();
  if (!t) return true;
  if (/^(&nbsp;|\u00A0)$/.test(t)) return true;
  if (/^[-–—]+$/.test(t)) return true; // 단순 대시
  if (/^(없음|미운영)$/i.test(t)) return true;
  return false;
}

async function fetchText(url, method="GET", body=null) {
  const req = new Request(url);
  req.method = method;
  req.headers = { "User-Agent": "Mozilla/5.0" };
  if (body) {
    req.headers["Content-Type"] = "application/x-www-form-urlencoded";
    req.body = body;
  }
  return await req.loadString();
}

// ---- 헤더 <th>에서 오늘 열 인덱스 찾기 ----
function findDayIndex(html) {
  const thList = html.match(/<th[^>]*>[\s\S]*?<\/th>/gi) || [];
  const targetDigits = `${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
  const targetDigitsShort = `${m}${d}`;

  const candidateTokens = new Set([
    todayTag,
    `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`,
    todayTag.replace("/", "."),
    `${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`,
    todayTag.replace("/", "-"),
    `${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    `${m}.${d}`,
    `${m}-${d}`,
    `${m}월${d}일`,
    `${String(m).padStart(2, "0")}월${String(d).padStart(2, "0")}일`,
    `${d}일`,
  ].map(v => v.replace(/\s+/g, "")));

  for (let i = 0; i < thList.length; i++) {
    const rawText = stripTagsToOneLine(thList[i]);
    const compact = rawText.replace(/\s+/g, "");
    if (!compact) continue;

    const digits = compact.replace(/\D/g, "");
    if (digits) {
      if (digits.endsWith(targetDigits) || digits.endsWith(targetDigitsShort)) {
        return i;
      }
    }

    for (const token of candidateTokens) {
      if (!token) continue;
      if (compact.includes(token)) {
        return i;
      }
    }
  }
  return -1;
}

// ---- tbody 파싱 (세종: 구분열 없음 기준 + 자동 보정) ----
function parseMealsFromTbody(html, dayIndex) {
  const tbodyMatch = html.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/i);
  if (!tbodyMatch) return { breakfast: EMPTY_LABEL, lunch: EMPTY_LABEL, dinner: EMPTY_LABEL };
  const tbody = tbodyMatch[0];

  const trList = tbody.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const result = { breakfast: EMPTY_LABEL, lunch: EMPTY_LABEL, dinner: EMPTY_LABEL };

  // 자동 보정: 첫 데이터 행의 첫 셀 텍스트로 구분열 존재 여부 체크
  let offset = 0;
  if (trList.length > 1) {
    const firstDataCells = trList[1].match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
    if (firstDataCells.length > 0) {
      const firstCell = stripTagsToOneLine(firstDataCells[0]).replace(/\s+/g, "");
      if (/\d{1,2}[\.\/-]\d{1,2}/.test(firstCell) || /\d{3,}/.test(firstCell) || /구분/.test(firstCell)) {
        offset = -1;
      } else {
        offset = 0;
      }
    }
  }

  for (const tr of trList) {
    const cells = tr.match(/<(?:td|th)[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
    if (cells.length === 0) continue;

    const typeCell = stripTagsToOneLine(cells[0]);
    const idx = dayIndex + offset;
    if (idx < 0 || idx >= cells.length) continue;

    const rawCell = cells[idx];
    if (isEmptyCell(rawCell)) continue;

    const menu = stripTagsToOneLine(rawCell) || EMPTY_LABEL;

    if (/조식|아침/i.test(typeCell)) {
      result.breakfast = menu;
    } else if (/중식|점심/i.test(typeCell)) {
      result.lunch = menu;
    } else if (/석식|저녁/i.test(typeCell)) {
      result.dinner = menu;
    }
  }

  return result;
}

// ---- 페이지에서 vt 후보 추출 ----
function extractAllVT(html) {
  return [...html.matchAll(/Method\.loadSchedule\(['"](\d+)['"]\s*,\s*['"]foodE['"]\)/gi)].map(m => m[1]);
}

// =================================================================
// ✅ MAIN
// =================================================================

let mainHTML = await fetchText(MAIN_URL);
let idx = findDayIndex(mainHTML);
let meals = null;

function withDefault(mealObj) {
  if (!mealObj) {
    return { breakfast: EMPTY_LABEL, lunch: EMPTY_LABEL, dinner: EMPTY_LABEL };
  }
  return mealObj;
}

// 1) 현재 주차에 오늘이 있으면 직접 파싱
if (idx !== -1) {
  meals = parseMealsFromTbody(mainHTML, idx);
}

// 2) 없거나, 전부 EMPTY면 AJAX로 다른 주차 로드
function allEmpty(mm) {
  if (!mm) return true;
  return [mm.breakfast, mm.lunch, mm.dinner].every(v => !v || v.trim() === "" || v === EMPTY_LABEL);
}

if (idx === -1 || allEmpty(meals)) {
  const candidates = extractAllVT(mainHTML);
  for (const vt of candidates) {
    const body = `vt=${vt}&bid=${encodeURIComponent(BID)}`;
    const ajaxHTML = await fetchText(AJAX_URL, "POST", body);
    const idx2 = findDayIndex(ajaxHTML);
    if (idx2 === -1) continue;

    const parsed = parseMealsFromTbody(ajaxHTML, idx2);
    if (!allEmpty(parsed)) {
      meals = parsed;
      break;
    }
  }
}

meals = withDefault(meals);

// 3) 위젯 렌더
let w = new ListWidget();
w.backgroundColor = Color.white();

let title = w.addText(`오늘의 기숙사 식단`);
title.font = Font.semiboldSystemFont(14);
title.textColor = Color.black();
w.addSpacer(4);

let dateLine = w.addText(todayLabel);
dateLine.font = Font.mediumSystemFont(11);
dateLine.textColor = Color.darkGray();
w.addSpacer(8);

function addLine(icon, label, text) {
  const clean = text && text.trim() ? text : EMPTY_LABEL;
  const t = w.addText(`${icon} ${label}: ${clean}`);
  t.font = Font.systemFont(11);
  t.textColor = Color.black();
  w.addSpacer(4);
}

const bfast = meals?.breakfast ?? EMPTY_LABEL;
const lunch = meals?.lunch ?? EMPTY_LABEL;
const dinner = meals?.dinner ?? EMPTY_LABEL;

addLine("🥣", "아침",  bfast);
addLine("🍱", "점심",  lunch);
addLine("🍚", "저녁",  dinner);

if ([bfast, lunch, dinner].every(v => v === EMPTY_LABEL)) {
  w.addSpacer(8);
  const note = w.addText("식단 정보가 없거나 주말입니다.");
  note.font = Font.italicSystemFont(10);
  note.textColor = Color.lightGray();
}

Script.setWidget(w);
Script.complete();
