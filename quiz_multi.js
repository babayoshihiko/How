/* --- スコア管理用 --- */
let correctCount = 0;
let answeredCount = 0;
let currentQuizData = []; 

/* =========================
    データ処理系
========================= */

/**
 * テキストにルビ変換（存在する場合）とMarkdown変換を適用する
 */
function applyRubyAndMd(text) {
    if (!text) return "";
    const targetText = String(text).trim();
    const hasRuby = typeof rubyConverter !== "undefined" && rubyConverter.sortedKanji && rubyConverter.sortedKanji.length > 0;
    const rubyfied = hasRuby ? rubyConverter.convert(targetText) : targetText;
    return mdInline(rubyfied);
}

/**
 * クイズの1問から、表示・印刷に必要な選択肢を生成・抽出する共通関数
 */
function prepareChoices(q, nChoice) {
  const actualCorrects = q.corrects || [];
  const actualWrongs = q.wrongs || [];
  const neededW = nChoice - actualCorrects.length;
  const selectedWrongs = shuffle([...actualWrongs]).slice(0, Math.max(0, neededW));

  const allChoices = [
    ...actualCorrects.map(c => ({ text: c, isCorrect: true })),
    ...selectedWrongs.map(w => ({ text: w, isCorrect: false }))
  ];
  return shuffle(allChoices);
}

function convertToQuizData(csvData) {
  if (!Array.isArray(csvData)) return [];
  return csvData.map(row => {
    if (!row) return null;
    const getSafeValRaw = (names) => {
      for (let name of names) {
        const matchKey = Object.keys(row).find(k => k.trim().toLowerCase() === name.toLowerCase());
        if (matchKey && row[matchKey] !== undefined && row[matchKey] !== null) return row[matchKey];
      }
      return null;
    };

    const questionRaw = getSafeValRaw(["question", "Question", "問題文"]);
    if (!questionRaw) return null; 

    let corrects = [];
    const mainC = getSafeValRaw(["correct", "corrects", "正解"]);
    if (Array.isArray(mainC)) corrects = [...mainC];
    else if (mainC) corrects.push(mainC);
    for (let i = 1; i <= 5; i++) {
      const c = getSafeValRaw([`correct${i}`]);
      if (c) corrects.push(c);
    }

    let wrongs = [];
    const mainW = getSafeValRaw(["wrong", "wrongs", "不正解"]);
    if (Array.isArray(mainW)) wrongs = [...mainW];
    else if (mainW) wrongs.push(mainW);
    for (let i = 1; i <= 10; i++) {
      const w = getSafeValRaw([`wrong${i}`]);
      if (w) wrongs.push(w);
    }

    const finalize = (arr) => [...new Set(arr.map(v => v.toString().trim()))].filter(Boolean);

    return {
      category: (getSafeValRaw(["category", "カテゴリ"]) || "未分類").toString().trim(),
      question: questionRaw.toString().trim(),
      corrects: finalize(corrects),
      wrongs: finalize(wrongs),
      explanation: (getSafeValRaw(["explanation", "解説"]) || "").toString().trim()
    };
  }).filter(Boolean);
}

async function loadData(url) {
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = `${url}${separator}v=${new Date().getTime()}`;
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error("ファイルの取得に失敗しました");
  if (url.toLowerCase().endsWith(".json")) {
    const jsonData = await res.json();
    return convertToQuizData(jsonData);
  } 
  const text = await res.text();
  const csvResult = Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  return convertToQuizData(csvResult);
}

/* =========================
    判定・UI制御系
========================= */

function toggleSelection(btn) {
  const quizItem = btn.closest(".quiz-item");
  if (!quizItem) return;
  const submitBtn = quizItem.querySelector(".submit-btn");
  if (submitBtn && submitBtn.disabled) return;
  btn.classList.toggle("selected");
}

function checkAnswerMulti(quizIndex, explanation) {
  const items = document.querySelectorAll(".quiz-item");
  const itemDiv = items[quizIndex];
  const result = itemDiv.querySelector(".result");
  const exp = itemDiv.querySelector(".explanation");
  const submitBtn = itemDiv.querySelector(".submit-btn");
  const choiceButtons = itemDiv.querySelectorAll(".choice-btn");

  const selectedButtons = Array.from(choiceButtons).filter(btn => btn.classList.contains("selected"));
  if (selectedButtons.length === 0) {
    alert("選択肢を1つ以上選んでください。");
    return;
  }

  submitBtn.disabled = true;
  choiceButtons.forEach(b => b.style.cursor = "default");
  answeredCount++;

  const selectedCorrectCount = selectedButtons.filter(btn => btn.dataset.correct === "true").length;
  const totalCorrectCount = Array.from(choiceButtons).filter(btn => btn.dataset.correct === "true").length;
  const isPerfect = (selectedCorrectCount === selectedButtons.length) && (selectedCorrectCount === totalCorrectCount);

  if (isPerfect) {
    result.textContent = "正解！";
    result.className = "result correct-text";
    correctCount++;
  } else {
    result.textContent = "不正解";
    result.className = "result wrong-text";
  }

  choiceButtons.forEach(btn => {
    if (btn.dataset.correct === "true") btn.classList.add("reveal-correct");
    if (btn.classList.contains("selected") && btn.dataset.correct === "false") btn.classList.add("reveal-wrong");
  });

  if (typeof updateScoreDisplay === "function") updateScoreDisplay();

  let html = applyRubyAndMd(explanation || "（解説なし）");
  exp.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ["ruby", "rt", "rp"] });
  exp.style.display = "block";
}

/* =========================
    表示・レンダリング系
========================= */

function renderQuiz(quizData, containerId = "quiz") {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "読み込み中...";

  let formattedData = Array.isArray(quizData) ? quizData : (quizData.quizData || []);
  let displayData = formattedData;

  if (window.quizConfig && Object.keys(window.quizConfig).length > 0) {
    const groups = formattedData.reduce((acc, obj) => {
      const key = obj.category || "未分類";
      if (!acc[key]) acc[key] = [];
      acc[key].push(obj);
      return acc;
    }, {});
    displayData = Object.keys(groups).flatMap(catName => {
      const limit = parseInt(window.quizConfig[catName], 10);
      return (!isNaN(limit) && limit > 0) ? shuffle([...groups[catName]]).slice(0, limit) : []; 
    });
  }

  if (window.noShuffleQuestions === false) displayData = shuffle(displayData);
  currentQuizData = displayData; 
  container.innerHTML = "";

  if (displayData.length === 0) {
    container.innerHTML = "条件に一致する問題がありません。";
    return;
  }

  let currentCategory = "";
  displayData.forEach((q, index) => {
    if (q.category && q.category !== currentCategory) {
      currentCategory = q.category;
      const categoryTitle = document.createElement("h3");
      categoryTitle.className = "category-title";
      categoryTitle.innerHTML = applyRubyAndMd(currentCategory);
      container.appendChild(categoryTitle);
    }
    const div = document.createElement("div");
    div.classList.add("quiz-item");
    const nChoice = window.kakomonNChoice || 5;
    const choices = prepareChoices(q, nChoice);
    const qText = applyRubyAndMd(q.question);
    let html = `<p><strong>Q${index + 1}. ${qText}</strong></p><div class="choices-container">`;
    choices.forEach(choice => {
      const cText = applyRubyAndMd(choice.text);
      html += `<button type="button" class="choice-btn" data-correct="${choice.isCorrect}" onclick="toggleSelection(this)">${cText}</button>`;
    });
    const safeExp = q.explanation ? q.explanation.replace(/'/g, "\\'").replace(/"/g, '&quot;') : "";
    html += `</div><button class="submit-btn" onclick="checkAnswerMulti(${index}, '${safeExp}')">ANSWER</button><p class="result"></p><div class="explanation" style="display:none;"></div>`;
    div.innerHTML = html;
    container.appendChild(div);
  });
}

function shuffle(array) {
  if (!Array.isArray(array)) return [];
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function mdInline(text) {
  if (!text) return "";
  const rawHtml = marked.parse(text.toString().replace(/\\n/g, "\n") || "");
  const cleanHtml = rawHtml.replace(/^<p>|<\/p>\n?$/g, "");
  return DOMPurify.sanitize(cleanHtml, { ADD_TAGS: ["ruby", "rt", "rp"] });
}

/* =========================
    スコア表示
========================= */

function updateScoreDisplay() {
  const scoreDiv = document.getElementById("score");
  if (!scoreDiv) return;
  const rate = answeredCount === 0 ? 0 : Math.round((correctCount / answeredCount) * 100);
  const comments = { start: ["まずは一問！"], low: ["がんばれ！"], high: ["この調子！"] };
  let comment = (answeredCount === 0) ? comments.start[0] : (rate < 60 ? comments.low[0] : comments.high[0]);
  scoreDiv.innerHTML = `<div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #fdfdfd; border-radius: 10px; border: 1px solid #eee; max-width: fit-content; margin-bottom: 20px;"><img src="Baba.png" alt="Baba" width="80" height="80" style="border-radius: 50%; border: 2px solid #007bff; background:white; object-fit: cover;"><div><div style="font-weight: bold; font-size: 1.1rem;">スコア: ${correctCount}/${answeredCount} (${rate}%)</div><div style="font-size: 0.9rem; color: #555; margin-top: 4px;">${comment}</div></div></div>`;
}

/* =========================
    印刷関連
========================= */

function preparePrint() {
  if (!currentQuizData || currentQuizData.length === 0) {
    alert("データがありません。");
    return;
  }
  renderQuizForPrint(currentQuizData);
}

function renderQuizForPrint(quizData) {
  const container = document.getElementById("quiz");
  if (!container) return;

  // 印刷用の一時的なスタイルを追加（余計な余白をカット）
  const style = document.createElement('style');
  style.innerHTML = `
    @media print {
      body { margin: 0; padding: 0; }
      #quiz { width: 100%; }
      .print-item { break-inside: avoid; page-break-inside: avoid; }
    }
  `;
  document.head.appendChild(style);

  // --- 1. 解答リスト（10列のグリッド形式）の生成 ---
  let answerSectionHtml = `
    <div style="border: 2px solid #000; padding: 15px; margin-bottom: 2rem;">
      <h3 style="margin-top:0; text-align:center; border-bottom:1px solid #000; padding-bottom:5px;">正答一覧</h3>
  `;

  const columnsPerRow = 10;
  const nChoice = window.kakomonNChoice || 5;
  const allCorrectInfos = [];

  quizData.forEach((q, index) => {
    const choices = prepareChoices(q, nChoice);
    const correctNumbers = choices
      .map((c, i) => (c.isCorrect ? (i + 1) : null))
      .filter(v => v !== null)
      .join(", ");
    allCorrectInfos.push({ id: index + 1, ans: correctNumbers });
  });

  for (let i = 0; i < allCorrectInfos.length; i += columnsPerRow) {
    answerSectionHtml += `<table style="width:100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 5px;"><tbody><tr>`;
    
    // 問題番号行
    for (let j = 0; j < columnsPerRow; j++) {
      const info = allCorrectInfos[i + j];
      answerSectionHtml += `<td style="border: 1px solid #000; padding: 5px; text-align: center; background: #eee; font-weight: bold;">${info ? info.id : ""}</td>`;
    }
    answerSectionHtml += `</tr><tr>`;
    
    // 正解番号行
    for (let j = 0; j < columnsPerRow; j++) {
      const info = allCorrectInfos[i + j];
      answerSectionHtml += `<td style="border: 1px solid #000; padding: 8px 2px; text-align: center; height: 1.5em;">${info ? info.ans : ""}</td>`;
    }
    answerSectionHtml += `</tr></tbody></table>`;
  }

  // 解答一覧の後に強制改ページ
  answerSectionHtml += `</div><div style="page-break-after: always; visibility: hidden;"></div>`;

  // --- 2. 問題エリアの生成 ---
  let questionsHtml = `
    <h2 style="text-align:center; margin-bottom: 1rem;">確認テスト</h2>
    <p style="text-align:right; margin-bottom: 2rem;">氏名：__________________________</p>
  `;

  quizData.forEach((q, index) => {
    const choices = prepareChoices(q, nChoice);
    const qText = applyRubyAndMd(q.question);
    
    questionsHtml += `
      <div class="print-item" style="margin-bottom: 1.5rem; break-inside: avoid; border-bottom: 1px dashed #ccc; padding-bottom: 1rem;">
        <p style="margin-bottom: 10px;"><strong>問${index + 1}. ${qText}</strong></p>
    `;

    choices.forEach((c, i) => {
      const cText = applyRubyAndMd(c.text);
      questionsHtml += `<div style="margin-left: 20px; margin-bottom: 0.4rem;">（ ${i + 1} ） ${cText}</div>`;
    });

    questionsHtml += `</div>`;
  });

  // 全体をセット
  container.innerHTML = answerSectionHtml + questionsHtml;

  // 印刷。reloadをなくして、ユーザーが閉じた後にリセットするか、手動で戻るようにします。
  setTimeout(() => { 
    window.print();
    // reloadの代わりに、印刷が終わったらスタイルを消すか検討
  }, 500);
}
