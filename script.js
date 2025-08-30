// script.js (versión con screeves y orden por persona)
// Carga datos JSON, búsqueda y renderizado de detalle con tablas por screeve.
// Soporta JSON en forma de array o { "conjugations": [...] } wrappers.

let verbs = [];
let conjugations = [];
let senses = [];
let pronunciations = [];

let pronByConj = new Map(); // key: conjugation_id -> pronunciation object
let pronByVerb = new Map(); // key: verb_id -> array of pronunciation objects

async function loadJsonFlexible(path, keyFallback) {
    try {
        const res = await fetch(path);
        if (!res.ok) return [];
        const data = await res.json();
        if (Array.isArray(data)) return data;
        if (data && typeof data === "object") {
            if (data[keyFallback] && Array.isArray(data[keyFallback])) return data[keyFallback];
            for (const k of Object.keys(data)) {
                if (Array.isArray(data[k])) return data[k];
            }
        }
        return [];
    } catch (e) {
        console.warn("loadJsonFlexible error", path, e);
        return [];
    }
}

async function loadData() {
    const [v, c, s, p] = await Promise.all([
        loadJsonFlexible("data/verbs.json", "verbs"),
        loadJsonFlexible("data/conjugations.json", "conjugations"),
        loadJsonFlexible("data/senses.json", "senses"),
        loadJsonFlexible("data/pronunciations.json", "pronunciations")
    ]);
    verbs = v;
    conjugations = c;
    senses = s;
    pronunciations = p;

    // normalize/prepare conjugations
    for (const conj of conjugations) {
        if (!("normalized_form" in conj) || conj.normalized_form == null) {
            conj.normalized_form = normalize(conj.conjugated_form || "");
        }
        // parse morphemes if stored as JSON string
        if (typeof conj.morphemes === "string") {
            try {
                const parsed = JSON.parse(conj.morphemes);
                if (Array.isArray(parsed)) conj._morphemes_arr = parsed;
                else conj._morphemes_arr = null;
            } catch (e) {
                conj._morphemes_arr = null;
            }
        } else if (Array.isArray(conj.morphemes)) {
            conj._morphemes_arr = conj.morphemes;
        } else {
            conj._morphemes_arr = null;
        }
    }

    // Build pronunciation maps for fast lookup
    pronByConj = new Map();
    pronByVerb = new Map();
    for (const pr of pronunciations) {
        // ensure ids are strings for consistent keying
        if (pr.conjugation_id != null && pr.conjugation_id !== "") {
            pronByConj.set(String(pr.conjugation_id), pr);
        } else if (pr.verb_id != null && pr.verb_id !== "") {
            const k = String(pr.verb_id);
            const arr = pronByVerb.get(k) || [];
            arr.push(pr);
            pronByVerb.set(k, arr);
        }
    }
}

function normalize(s) {
    if (!s && s !== "") return "";
    return String(s).normalize("NFKC").replace(/\s+/g, "").replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "").toLowerCase();
}

// ---------- INDEX PAGE LOGIC ----------
if (document.getElementById("search")) {
    const searchInput = document.getElementById("search");
    const results = document.getElementById("results");
    const spinner = document.getElementById("spinner");

    (async () => {
        spinner?.classList.remove("hidden");
        await loadData();
        spinner?.classList.add("hidden");
    })();

    let debounceTimer = null;
    searchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runSearch, 150);
    });

    function runSearch() {
        const q = normalize(searchInput.value);
        results.innerHTML = "";
        if (!q) return;

        const exact = conjugations.filter(c => (c.normalized_form || "").toLowerCase() === q);
        const partial = conjugations.filter(c => (c.normalized_form || "").toLowerCase().includes(q));
        const seen = new Set();
        const matches = [];
        for (const c of [...exact, ...partial]) {
            if (!seen.has(c.id)) {
                seen.add(c.id);
                matches.push(c);
            }
            if (matches.length >= 50) break;
        }

        if (matches.length === 0) {
            results.innerHTML = `<li class="p-4 text-sm text-gray-500">No forms were found.</li>`;
            return;
        }

        for (const m of matches.slice(0, 30)) {
            const verb = verbs.find(v => Number(v.id) === Number(m.verb_id)) || {};
            const s = senses.find(ss => Number(ss.verb_id) === Number(verb.id));
            const gloss = s ? (s.gloss || "") : "";
            const li = document.createElement("li");

            li.className = "p-3 hover:bg-indigo-50 cursor-pointer transition flex justify-between items-center";
            li.innerHTML = `<div>
                        <div class="text-lg font-medium">${m.conjugated_form}</div>
                        <div class="text-sm text-gray-500">${verb.root ? verb.root : "—"} · ${m.tense || ""} ${gloss ? "· " + gloss : ""}</div>
                      </div>
                      <div class="text-sm text-indigo-600">Ver</div>`;
            li.onclick = () => {
                const vid = verb.id || m.verb_id;
                window.location.href = `verb.html?id=${vid}&highlight=${m.id}`;
            };
            results.appendChild(li);
        }
    }
}

// ---------- VERB PAGE LOGIC (render with screeves) ----------
if (window.location.pathname.includes("verb.html")) {
    (async () => {
        await loadData();
        renderVerbDetail();
    })();
}

function renderVerbDetail() {
    const T = {
        presente: ["presente", "present"],
        imperfect: ["imperfect", "imperfecto", "imperfect"],
        future: ["future", "futuro"],
        conditional: ["conditional", "condicional"],
        aorist: ["aorist", "aoristo"],
        optative: ["optative", "optativo"],
        perfect: ["perfect", "perfecto", "perfecto_indicativo", "perfecto_indicativo"],
        pluperfect: ["pluperfect", "pluperfecto", "pluscuamperfecto", "pluscuamperfecto_indicativo"]
    };

    // canonicalize possible tense/mood variants (spanish/english)
    const M = {
        indicative: ["indicative", "indicativo", ""], // treat empty as indicative fallback
        subjunctive: ["subjunctive", "subjunctive", "subjunctive", "subjunctive", "subjunctive", "subjunctive", "subjunctive", "subjunctive", "subjunctive", "subjunctive"],
        subj: ["subjunctive", "subjunctive", "subjunctive", "subjunctive", "subj"]
    };
    // simpler mood aliases
    const moodIndicative = ["indicative", "indicativo", ""];
    const moodSubj = ["subjunctive", "subjunctive", "subj", "subjunctivo", "subjunctive"];

    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    const detail = document.getElementById("verb-detail");
    if (!id) {
        detail.innerHTML = `<p class="text-gray-600">Verb not specified.</p>`;
        return;
    }
    const verb = verbs.find(v => String(v.id) === String(id));
    if (!verb) {
        detail.innerHTML = `<p class="text-gray-600">Verb not fount (id=${id}).</p>`;
        return;
    }

    // prepare related data
    const verbConjs = conjugations.filter(c => String(c.verb_id) === String(id));
    const verbSenses = senses.filter(s => String(s.verb_id) === String(id));
    const verbPron = pronunciations.filter(p => String(p.verb_id) === String(id));

    const baseFormConj = verbConjs.find(c => c.person === "3sg" && matches(c, T.presente, moodIndicative));
    const displayRoot = baseFormConj ? baseFormConj.conjugated_form : verb.root;
    // header
    detail.innerHTML = `
    <head>
        <title>Geoverb - ${displayRoot}</title>
    </head>
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-3xl font-semibold">${displayRoot}</h2>
        <div class="text-sm text-gray-600 mt-1">${verb.notes || ""}</div>
        <div class="mt-2 text-sm text-gray-500">Present Suffix: ${verb.present_suffix || "—"} · Future Suffix: ${verb.future_suffix || "—"}</div>
      </div>
    </div>
    <section class="mt-6">
      <h3 class="text-lg font-medium mb-2">Significados</h3>
      <div id="senses-block" class="text-sm text-gray-700">
        ${
            verbSenses.length
                ? `<ol class="list-decimal ml-5 space-y-2">
                ${verbSenses.map(s => `
                  <li>
                    <strong>${s.gloss || ""}</strong>: ${s.definition || ""}
                    ${
                    s.examples
                        ? `<ul class="list-disc ml-6 mt-1 text-xs text-gray-500">
                            ${s.examples.split("|").map(e => `<li>${e.trim()}</li>`).join("")}
                          </ul>`
                        : ""
                }
                  </li>
                `).join("")}
              </ol>`
                : `<div class="text-gray-500">No definitions registered.</div>`
        }
      </div>
    </section>

    <section id="screeves-block" class="mt-6">
          <h3 class="text-lg font-medium mb-2">Conjugations</h3>
      <div id="screeves-container" class="space-y-6"></div>
    </section>

    <section class="mt-6">
      <h3 class="text-lg font-medium mb-2">Pronunciations</h3>
      <div id="pron-block" class="text-sm"></div>
    </section>
  `;

    // --- helper: normalization/alias for tense and mood ---
    function normT(x) {
        if (!x && x !== "") return "";
        return String(x).trim().toLowerCase();
    }
    function isTense(conj, tenseAliases) {
        // tenseAliases: array of acceptable tense names (localized variants)
        const t = normT(conj.tense);
        return tenseAliases.includes(t);
    }
    function isMood(conj, moodAliases) {
        const m = normT(conj.mood || "");
        return moodAliases.includes(m);
    }
    // combined matcher
    function matches(conj, tenseAliases, moodAliases) {
        // moodAliases can be null meaning "any mood"
        if (!isTense(conj, tenseAliases)) return false;
        if (!moodAliases) return true;
        return isMood(conj, moodAliases);
    }

    // define screeves as conditions (tenseAliases, moodAliases or null)
    const screeves = [
        { key: "present", title: "Present Screeve", pieces: [
                { tense: T.presente, mood: moodIndicative, label: "Present" },
                { tense: T.imperfect, mood: moodIndicative, label: "Imperfect" },
                { tense: T.presente, mood: moodSubj, label: "Present Subj" },
            ]
        },
        { key: "future", title: "Future Screeve", pieces: [
                { tense: T.future, mood: moodIndicative, label: "Future" },
                { tense: T.conditional, mood: null, label: "Conditional" },
                { tense: T.future, mood: moodSubj, label: "Future Subj" },
            ]
        },
        { key: "aorist", title: "Aorist Screeve", pieces: [
                { tense: T.aorist, mood: null, label: "Aorist" },
                { tense: T.optative, mood: null, label: "Optative" },
            ]
        },
        { key: "perfect", title: "Perfect Screeve", pieces: [
                { tense: T.perfect, mood: null, label: "Perfect" },
                { tense: T.pluperfect, mood: null, label: "Pluperfect" },
            ]
        }
    ];

    const personOrder = ["1sg","2sg","3sg","1pl","2pl","3pl"];

    const container = document.getElementById("screeves-container");
    container.innerHTML = "";

    // For each screeve, build tables only if any piece has data
    for (const sc of screeves) {
        // check if any conjugation matches any piece in this screeve
        let anyInScree = false;
        for (const piece of sc.pieces) {
            const found = verbConjs.find(c => matches(c, piece.tense, piece.mood));
            if (found) { anyInScree = true; break; }
        }
        if (!anyInScree) continue;

        const scEl = document.createElement("div");
        scEl.className = "bg-white p-4 rounded-lg shadow-sm";
        scEl.innerHTML = `<div class="flex items-center justify-between mb-3"><div class="font-medium">${sc.title}</div><div class="text-sm text-gray-500">${sc.pieces.map(p=>p.label).join(" · ")}</div></div>`;

        // for each piece (tense) render a mini-table
        for (const piece of sc.pieces) {
            // build header and body
            const table = document.createElement("table");
            table.className = "w-full text-sm table-auto border-collapse mb-4";
            table.innerHTML = `
        <thead>
          <tr class="text-gray-600 border-b">
            <th class="py-2 px-3 text-left">Person</th>
            <th class="py-2 px-3 text-left">Form</th>
            <th class="py-2 px-3 text-left">Morphemes</th>
            <th class="py-2 px-3 text-left">IPA</th>
            <th class="py-2 px-3 text-left">Audio</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
            const tbody = table.querySelector("tbody");

            // for each personOrder find the conjugation that matches this piece
            for (const person of personOrder) {
                // find conj where tense matches piece.tense and mood matches piece.mood (or any mood if null)
                const c = verbConjs.find(cc => {
                    const tenseOk = matches(cc, piece.tense, null) || isTense(cc, piece.tense);
                    // If piece.mood is null, accept any mood; else require mood match
                    const moodOk = piece.mood ? isMood(cc, piece.mood) : true;
                    // require person match too
                    const personOk = ((cc.person || "").toLowerCase() === person);
                    return tenseOk && moodOk && personOk;
                });

                const form = c ? (c.conjugated_form || "") : "";
                // IPA: prefer pronunciation linked to conjugation (pronByConj), fallback to c.ipa
                let ipa = "";
                if (c) {
                    const pPron = pronByConj.get(String(c.id));
                    ipa = pPron?.ipa || c.ipa || "";
                }
                // audio for this exact conjugation (if present)
                const audioHtml = (() => {
                    if (!c) return "";
                    const pPron = pronByConj.get(String(c.id));
                    if (pPron && pPron.audio_url) return `<audio controls src="${pPron.audio_url}" class="w-36"></audio>`;
                    return "";
                })();

                const morphemesHtml = c && c._morphemes_arr ? c._morphemes_arr.join(" · ") : (c && c.morphemes && typeof c.morphemes === "string" ? c.morphemes : "");

                const tr = document.createElement("tr");
                tr.className = "border-b even:bg-gray-50";
                tr.innerHTML = `
          <td class="py-2 px-3 align-top font-medium">${person}</td>
          <td class="py-2 px-3 align-top">${form}</td>
          <td class="py-2 px-3 align-top text-xs text-gray-500">${morphemesHtml}</td>
          <td class="py-2 px-3 align-top">${ipa ? `<span class="ipa">${ipa}</span>` : ""}</td>
          <td class="py-2 px-3 align-top">${audioHtml}</td>
        `;
                tbody.appendChild(tr);
            }

            // only append the table if at least one row has a form (otherwise it's empty)
            const hasAnyForm = Array.from(tbody.querySelectorAll("tr td:nth-child(2)")).some(td => td.innerText.trim() !== "");
            if (hasAnyForm) {
                // add title above table
                const tTitle = document.createElement("div");
                tTitle.className = "text-sm font-semibold mb-2";
                tTitle.textContent = piece.label;
                scEl.appendChild(tTitle);
                scEl.appendChild(table);
            }
        }

        container.appendChild(scEl);
    }

    if (container.children.length === 0) {
        container.innerHTML = `<div class="text-gray-500">No hay conjugaciones registradas para este verbo.</div>`;
    }
}
