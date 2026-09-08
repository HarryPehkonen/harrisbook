// @ts-check
/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="es2022" />
/**
 * Harrisbook frontend — vanilla ES modules, no build step.
 *
 * All user-supplied text is rendered with textContent / DOM node creation only;
 * innerHTML is never used with dynamic data.
 */

/** @typedef {{ id:number, board_slug:string, originator:string, subject:string, body:string, created_at:string, updated_at:string }} Post */
/** @typedef {{ slug:string, created_at:string, post_count:number, last_post_at:string|null }} Board */

const state = {
  /** @type {Board[]} */ boards: [],
  /** @type {string|null} */ currentBoard: null,
  /** @type {{ email:string, role:string }|null} */ user: null,
  /** @type {string|null} */ searchQuery: null,
};

const $ = (/** @type {string} */ id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
};

/**
 * @param {string} path
 * @param {RequestInit} [opts]
 * @returns {Promise<any>}
 */
async function api(path, opts) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    const err = (json && json.error) || `request failed (${res.status})`;
    throw new Error(err);
  }
  return json.data;
}

/** @param {string} iso */
function relTime(iso) {
  const then = new Date(iso).getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * @param {string} tag
 * @param {Record<string,string>} [attrs]
 * @param {(Node|string)[]} [children]
 */
function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else node.setAttribute(k, v);
    }
  }
  for (const child of children || []) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function loadAuth() {
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
  } catch {
    state.user = null;
  }
  renderAuth();
  $("compose").hidden = !state.user;
}

function renderAuth() {
  const area = $("auth-area");
  area.replaceChildren();
  if (state.user) {
    area.append(
      el("span", { class: "user-chip" }, [state.user.email]),
      el("button", { class: "btn btn-ghost", id: "logout-btn" }, ["Sign out"]),
    );
    $("logout-btn").addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      location.reload();
    });
  } else {
    const link = el("a", { class: "btn btn-primary", href: "/api/auth/login" }, [
      "Sign in with Google",
    ]);
    area.append(link);
  }
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

async function loadBoards() {
  state.boards = await api("/api/boards");
  renderBoards();
  renderComposeBoards();
}

function renderBoards() {
  const list = $("board-list");
  list.replaceChildren();
  if (state.boards.length === 0) {
    list.append(el("li", { class: "empty" }, ["No boards yet"]));
    return;
  }
  for (const b of state.boards) {
    const btn = el("button", {
      class: "board-item" + (b.slug === state.currentBoard ? " active" : ""),
    }, [
      el("span", { class: "board-name" }, [b.slug]),
      el("span", { class: "board-count" }, [String(b.post_count)]),
    ]);
    btn.addEventListener("click", () => selectBoard(b.slug));
    list.append(el("li", {}, [btn]));
  }
}

function renderComposeBoards() {
  const fs = $("compose-boards");
  fs.replaceChildren(el("legend", {}, ["Post to boards"]));
  for (const b of state.boards) {
    const id = `cb-${b.slug}`;
    const cb = el("input", { type: "checkbox", id, value: b.slug });
    if (b.slug === state.currentBoard) /** @type {HTMLInputElement} */ (cb).checked = true;
    fs.append(el("label", { class: "check" }, [cb, ` ${b.slug}`]));
  }
}

/** @param {string} slug */
async function selectBoard(slug) {
  state.currentBoard = slug;
  state.searchQuery = null;
  $("search-clear").hidden = true;
  renderBoards();
  $("thread-title").textContent = slug;
  await loadPosts();
}

async function loadPosts() {
  if (!state.currentBoard) return;
  const posts = await api(
    `/api/boards/${encodeURIComponent(state.currentBoard)}/posts?limit=100`,
  );
  renderPosts(posts);
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/** @param {Post[]} posts */
function renderPosts(posts) {
  const box = $("posts");
  box.replaceChildren();
  if (posts.length === 0) {
    box.append(el("p", { class: "empty" }, ["No posts."]));
    return;
  }
  for (const p of posts) {
    box.append(renderPost(p));
  }
}

/** @param {Post} p */
function renderPost(p) {
  const edited = p.updated_at && p.updated_at !== p.created_at;
  const meta = el("div", { class: "post-meta" }, [
    el("span", { class: "post-from" }, [p.originator]),
    el("span", { class: "post-board" }, [p.board_slug]),
    el("span", { class: "post-time" }, [
      relTime(p.created_at) + (edited ? " · edited" : ""),
    ]),
  ]);
  const article = el("article", { class: "post" }, [
    meta,
    el("h3", { class: "post-subject" }, [p.subject]),
    el("p", { class: "post-body" }, [p.body || ""]),
  ]);
  if (state.user) {
    const editBtn = el("button", { class: "btn btn-ghost btn-sm" }, ["Edit"]);
    editBtn.addEventListener("click", () => showEditForm(article, p));
    article.append(editBtn);
  }
  return article;
}

/**
 * @param {HTMLElement} article
 * @param {Post} p
 */
function showEditForm(article, p) {
  const subject = el("input", { type: "text", maxlength: "200" });
  /** @type {HTMLInputElement} */ (subject).value = p.subject;
  const body = el("textarea", { rows: "4", maxlength: "10000" });
  /** @type {HTMLTextAreaElement} */ (body).value = p.body || "";
  const msg = el("span", { class: "msg", role: "status" }, []);
  const save = el("button", { class: "btn btn-primary btn-sm" }, ["Save"]);
  const cancel = el("button", { class: "btn btn-ghost btn-sm" }, ["Cancel"]);

  const form = el("div", { class: "edit-form" }, [
    el("label", {}, ["Subject", subject]),
    el("label", {}, ["Body", body]),
    el("div", { class: "compose-actions" }, [save, cancel, msg]),
  ]);

  save.addEventListener("click", async () => {
    try {
      await api(`/api/posts/${p.id}`, {
        method: "PUT",
        body: JSON.stringify({
          subject: /** @type {HTMLInputElement} */ (subject).value,
          body: /** @type {HTMLTextAreaElement} */ (body).value,
        }),
      });
      if (state.searchQuery) await runSearch(state.searchQuery);
      else await loadPosts();
    } catch (e) {
      msg.textContent = e instanceof Error ? e.message : "Save failed";
    }
  });
  cancel.addEventListener("click", () => {
    if (state.searchQuery) runSearch(state.searchQuery);
    else loadPosts();
  });

  article.replaceChildren(form);
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

async function submitCompose() {
  const msg = $("compose-msg");
  msg.textContent = "";
  const subject = /** @type {HTMLInputElement} */ ($("compose-subject")).value.trim();
  const body = /** @type {HTMLTextAreaElement} */ ($("compose-body")).value;
  const checked = Array.from(
    document.querySelectorAll("#compose-boards input:checked"),
  ).map((c) => /** @type {HTMLInputElement} */ (c).value);
  const newBoard = /** @type {HTMLInputElement} */ ($("compose-newboard")).value.trim();
  if (newBoard) checked.push(newBoard);

  if (!subject) return void (msg.textContent = "Subject is required");
  if (checked.length === 0) return void (msg.textContent = "Pick at least one board");

  try {
    await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({ boards: checked, subject, body }),
    });
    /** @type {HTMLInputElement} */ ($("compose-subject")).value = "";
    /** @type {HTMLTextAreaElement} */ ($("compose-body")).value = "";
    /** @type {HTMLInputElement} */ ($("compose-newboard")).value = "";
    msg.textContent = "Posted.";
    await loadBoards();
    await selectBoard(checked[0]);
  } catch (e) {
    msg.textContent = e instanceof Error ? e.message : "Post failed";
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** @param {string} q */
async function runSearch(q) {
  state.searchQuery = q;
  state.currentBoard = null;
  renderBoards();
  $("thread-title").textContent = `Search: ${q}`;
  $("search-clear").hidden = false;
  const posts = await api(`/api/search?q=${encodeURIComponent(q)}`);
  renderPosts(posts);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire() {
  $("search-btn").addEventListener("click", () => {
    const q = /** @type {HTMLInputElement} */ ($("search-input")).value.trim();
    if (q) runSearch(q);
  });
  $("search-input").addEventListener("keydown", (e) => {
    if (/** @type {KeyboardEvent} */ (e).key === "Enter") $("search-btn").click();
  });
  $("search-clear").addEventListener("click", () => {
    /** @type {HTMLInputElement} */ ($("search-input")).value = "";
    $("search-clear").hidden = true;
    state.searchQuery = null;
    if (state.boards[0]) selectBoard(state.boards[0].slug);
  });
  $("compose-submit").addEventListener("click", submitCompose);
}

async function init() {
  wire();
  await loadAuth();
  await loadBoards();
  if (state.boards[0]) await selectBoard(state.boards[0].slug);
  // Auto-refresh the board list + current view periodically.
  setInterval(async () => {
    try {
      await loadBoards();
      if (state.currentBoard) await loadPosts();
    } catch {
      /* transient — ignore */
    }
  }, 15000);
}

init();
