/* DUCKi by AEON DUX — a browser-based agent (formerly EasyClaw Console).
 * Bring-your-own-key. Everything runs client-side; keys live in localStorage
 * and are sent only to the provider you choose. No backend.
 */
(function () {
  'use strict'

  // ----- tiny helpers -----
  var $ = function (id) { return document.getElementById(id) }
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v } catch (e) { return d } },
    set: function (k, v) { try { localStorage.setItem(k, v) } catch (e) {} }
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function renderMarkdown(s) {
    // minimal: escape, code fences, inline code, line breaks
    var text = esc(s)
    text = text.replace(/```([\s\S]*?)```/g, function (_, c) { return '<pre><code>' + c.replace(/^\n/, '') + '</code></pre>' })
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    return text
  }
  function setDot(id, state) {
    var el = $(id); if (!el) return
    el.className = 'dot' + (state === 'on' ? ' on' : state === 'err' ? ' err' : '')
  }
  function status(id, msg, kind) {
    var el = $(id); if (!el) return
    el.textContent = msg || ''
    el.className = 'status-line' + (kind ? ' ' + kind : '')
  }

  // ----- default models per provider -----
  var DEFAULT_MODEL = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-latest',
    gemini: 'gemini-2.0-flash',
    deepseek: 'deepseek-chat',
    glm: 'glm-4-flash',
    qwen: 'qwen-turbo',
    kimi: 'moonshot-v1-8k',
    openrouter: 'deepseek/deepseek-chat-v3-0324:free',
    siliconflow: 'deepseek-ai/DeepSeek-V3'
  }

  // ----- state -----
  var state = {
    llm: { provider: LS.get('ec_llm_provider', 'openai'), model: '', key: '' },
    gh: { token: '', user: null },
    fc: { key: '' },
    gm: { clientId: '', token: null, email: null, tokenClient: null },
    allowWrites: LS.get('ec_allow_writes', '0') === '1',
    history: [] // {role:'user'|'assistant'|'tool', text, toolCalls, id, name, result}
  }

  // ======================================================================
  //  TOOLS
  // ======================================================================
  function ghHeaders() {
    return {
      Authorization: 'Bearer ' + state.gh.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }
  function requireGitHub() { if (!state.gh.token) throw new Error('GitHub is not connected. Ask the user to paste a token in the sidebar.') }
  function requireWrite() { if (!state.allowWrites) throw new Error('Write actions are disabled. Ask the user to enable "Allow write actions" in the sidebar.') }

  var TOOLS = {
    github_me: {
      description: 'Get the authenticated GitHub user (login, name, public repo count).',
      parameters: { type: 'object', properties: {} },
      run: function () {
        requireGitHub()
        return fetch('https://api.github.com/user', { headers: ghHeaders() }).then(checkJson).then(function (u) {
          return { login: u.login, name: u.name, public_repos: u.public_repos, followers: u.followers }
        })
      }
    },
    github_list_repos: {
      description: 'List the authenticated user\'s repositories, most recently updated first.',
      parameters: { type: 'object', properties: { limit: { type: 'number', description: 'max repos (default 10)' } } },
      run: function (a) {
        requireGitHub()
        var n = Math.min(a && a.limit ? a.limit : 10, 50)
        return fetch('https://api.github.com/user/repos?sort=updated&per_page=' + n, { headers: ghHeaders() })
          .then(checkJson).then(function (rs) {
            return rs.map(function (r) { return { full_name: r.full_name, private: r.private, description: r.description, updated_at: r.updated_at, stars: r.stargazers_count } })
          })
      }
    },
    github_get_file: {
      description: 'Read a file from a GitHub repo. Returns decoded text content.',
      parameters: { type: 'object', properties: {
        repo: { type: 'string', description: 'owner/repo' },
        path: { type: 'string', description: 'file path in the repo' },
        ref: { type: 'string', description: 'branch or commit (optional)' }
      }, required: ['repo', 'path'] },
      run: function (a) {
        requireGitHub()
        var url = 'https://api.github.com/repos/' + a.repo + '/contents/' + encodeURIComponent(a.path).replace(/%2F/g, '/')
        if (a.ref) url += '?ref=' + encodeURIComponent(a.ref)
        return fetch(url, { headers: ghHeaders() }).then(checkJson).then(function (f) {
          var content = f.content ? decodeURIComponent(escape(atob(f.content.replace(/\n/g, '')))) : ''
          if (content.length > 8000) content = content.slice(0, 8000) + '\n…[truncated]'
          return { path: f.path, size: f.size, content: content }
        })
      }
    },
    github_search_repos: {
      description: 'Search public GitHub repositories.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: function (a) {
        requireGitHub()
        return fetch('https://api.github.com/search/repositories?per_page=8&q=' + encodeURIComponent(a.query), { headers: ghHeaders() })
          .then(checkJson).then(function (d) {
            return (d.items || []).map(function (r) { return { full_name: r.full_name, description: r.description, stars: r.stargazers_count, url: r.html_url } })
          })
      }
    },
    github_create_issue: {
      description: 'Create an issue in a GitHub repo. Requires write actions to be enabled.',
      parameters: { type: 'object', properties: {
        repo: { type: 'string', description: 'owner/repo' },
        title: { type: 'string' },
        body: { type: 'string' }
      }, required: ['repo', 'title'] },
      run: function (a) {
        requireGitHub(); requireWrite()
        return fetch('https://api.github.com/repos/' + a.repo + '/issues', {
          method: 'POST', headers: ghHeaders(), body: JSON.stringify({ title: a.title, body: a.body || '' })
        }).then(checkJson).then(function (i) { return { number: i.number, url: i.html_url } })
      }
    },
    firecrawl_scrape: {
      description: 'Scrape a web page and return its content as markdown (uses Firecrawl).',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: function (a) {
        if (!state.fc.key) throw new Error('Firecrawl is not connected. Ask the user to paste a Firecrawl key.')
        return fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + state.fc.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: a.url, formats: ['markdown'] })
        }).then(checkJson).then(function (d) {
          var md = (d.data && d.data.markdown) || d.markdown || ''
          if (md.length > 8000) md = md.slice(0, 8000) + '\n…[truncated]'
          return { url: a.url, markdown: md }
        }).catch(function (e) {
          throw new Error('Firecrawl request failed (likely CORS from the browser): ' + e.message)
        })
      }
    },
    gmail_list: {
      description: 'List recent Gmail messages matching an optional query (e.g. "is:unread").',
      parameters: { type: 'object', properties: {
        query: { type: 'string', description: 'Gmail search query, optional' },
        limit: { type: 'number', description: 'max messages (default 5)' }
      } },
      run: function (a) {
        requireGmail()
        var n = Math.min(a && a.limit ? a.limit : 5, 15)
        var url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=' + n
        if (a && a.query) url += '&q=' + encodeURIComponent(a.query)
        return fetch(url, { headers: { Authorization: 'Bearer ' + state.gm.token } }).then(checkJson).then(function (d) {
          var ids = (d.messages || []).map(function (m) { return m.id })
          return Promise.all(ids.map(getGmailMeta)).then(function (msgs) { return msgs })
        })
      }
    },
    gmail_get: {
      description: 'Get a single Gmail message by id, including a snippet of its body.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      run: function (a) {
        requireGmail()
        return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + a.id + '?format=full', {
          headers: { Authorization: 'Bearer ' + state.gm.token }
        }).then(checkJson).then(parseGmailFull)
      }
    }
  }

  function requireGmail() { if (!state.gm.token) throw new Error('Gmail is not connected. Ask the user to click "Connect Gmail" in the sidebar.') }
  function getGmailMeta(id) {
    return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + id + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date', {
      headers: { Authorization: 'Bearer ' + state.gm.token }
    }).then(checkJson).then(function (m) {
      var h = {}; ((m.payload && m.payload.headers) || []).forEach(function (x) { h[x.name.toLowerCase()] = x.value })
      return { id: id, from: h.from, subject: h.subject, date: h.date, snippet: m.snippet }
    })
  }
  function parseGmailFull(m) {
    var h = {}; ((m.payload && m.payload.headers) || []).forEach(function (x) { h[x.name.toLowerCase()] = x.value })
    var body = ''
    function walk(p) {
      if (!p) return
      if (p.mimeType === 'text/plain' && p.body && p.body.data) { body += b64url(p.body.data) }
      else if (p.parts) p.parts.forEach(walk)
    }
    walk(m.payload)
    if (!body && m.payload && m.payload.body && m.payload.body.data) body = b64url(m.payload.body.data)
    if (body.length > 6000) body = body.slice(0, 6000) + '\n…[truncated]'
    return { id: m.id, from: h.from, subject: h.subject, date: h.date, snippet: m.snippet, body: body }
  }
  function b64url(d) { try { return decodeURIComponent(escape(atob(d.replace(/-/g, '+').replace(/_/g, '/')))) } catch (e) { return '' } }

  function checkJson(r) {
    return r.text().then(function (t) {
      var data; try { data = t ? JSON.parse(t) : {} } catch (e) { data = { raw: t } }
      if (!r.ok) {
        var msg = (data && (data.message || data.error || (data.error && data.error.message))) || r.status + ' ' + r.statusText
        if (data && data.error && data.error.message) msg = data.error.message
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
      }
      return data
    })
  }

  // tool schema for the LLMs
  function toolSpecs() {
    return Object.keys(TOOLS).map(function (name) {
      return { name: name, description: TOOLS[name].description, parameters: TOOLS[name].parameters }
    })
  }

  // ======================================================================
  //  LLM ADAPTERS  (normalize history -> request, response -> {text, toolCalls})
  // ======================================================================
  var SYSTEM = 'You are EasyClaw, a helpful autonomous agent running in the user\'s browser. ' +
    'You have tools to access the user\'s connected GitHub, Gmail and Firecrawl. ' +
    'Use tools when they help; call them with correct arguments. When a tool is not connected, ' +
    'tell the user which sidebar connection to set up. Be concise and get things done.'

  function groupForToolResults(history) {
    // returns history as-is; adapters handle grouping
    return history
  }

  // ---- OpenAI / DeepSeek (OpenAI-compatible) ----
  function callOpenAI(baseURL) {
    return function () {
      var messages = [{ role: 'system', content: SYSTEM }]
      state.history.forEach(function (h) {
        if (h.role === 'user') messages.push({ role: 'user', content: h.text })
        else if (h.role === 'assistant') {
          var m = { role: 'assistant', content: h.text || null }
          if (h.toolCalls && h.toolCalls.length) {
            m.tool_calls = h.toolCalls.map(function (tc) {
              return { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }
            })
          }
          messages.push(m)
        } else if (h.role === 'tool') {
          messages.push({ role: 'tool', tool_call_id: h.id, content: JSON.stringify(h.result) })
        }
      })
      var body = {
        model: state.llm.model,
        messages: messages,
        tools: toolSpecs().map(function (t) { return { type: 'function', function: t } }),
        tool_choice: 'auto'
      }
      return fetch(baseURL + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + state.llm.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(checkJson).then(function (d) {
        var msg = d.choices[0].message
        var toolCalls = (msg.tool_calls || []).map(function (tc) {
          var args = {}; try { args = JSON.parse(tc.function.arguments || '{}') } catch (e) {}
          return { id: tc.id, name: tc.function.name, args: args }
        })
        return { text: msg.content || '', toolCalls: toolCalls }
      })
    }
  }

  // ---- Anthropic ----
  function callAnthropic() {
    var messages = []
    state.history.forEach(function (h) {
      if (h.role === 'user') messages.push({ role: 'user', content: [{ type: 'text', text: h.text }] })
      else if (h.role === 'assistant') {
        var content = []
        if (h.text) content.push({ type: 'text', text: h.text })
        ;(h.toolCalls || []).forEach(function (tc) { content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} }) })
        messages.push({ role: 'assistant', content: content })
      } else if (h.role === 'tool') {
        // merge into previous user message if it already holds tool_results
        var block = { type: 'tool_result', tool_use_id: h.id, content: JSON.stringify(h.result) }
        var last = messages[messages.length - 1]
        if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0] && last.content[0].type === 'tool_result') {
          last.content.push(block)
        } else {
          messages.push({ role: 'user', content: [block] })
        }
      }
    })
    var body = {
      model: state.llm.model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: messages,
      tools: toolSpecs().map(function (t) { return { name: t.name, description: t.description, input_schema: t.parameters } })
    }
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': state.llm.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(checkJson).then(function (d) {
      var text = '', toolCalls = []
      ;(d.content || []).forEach(function (b) {
        if (b.type === 'text') text += b.text
        else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, args: b.input || {} })
      })
      return { text: text, toolCalls: toolCalls }
    })
  }

  // ---- Google Gemini ----
  function callGemini() {
    var contents = []
    state.history.forEach(function (h) {
      if (h.role === 'user') contents.push({ role: 'user', parts: [{ text: h.text }] })
      else if (h.role === 'assistant') {
        var parts = []
        if (h.text) parts.push({ text: h.text })
        ;(h.toolCalls || []).forEach(function (tc) { parts.push({ functionCall: { name: tc.name, args: tc.args || {} } }) })
        contents.push({ role: 'model', parts: parts })
      } else if (h.role === 'tool') {
        var fr = { functionResponse: { name: h.name, response: { result: h.result } } }
        var last = contents[contents.length - 1]
        if (last && last.role === 'user' && last.parts[0] && last.parts[0].functionResponse) last.parts.push(fr)
        else contents.push({ role: 'user', parts: [fr] })
      }
    })
    var body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: contents,
      tools: [{ functionDeclarations: toolSpecs() }]
    }
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + state.llm.model + ':generateContent?key=' + encodeURIComponent(state.llm.key)
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(checkJson).then(function (d) {
        var cand = d.candidates && d.candidates[0]
        var text = '', toolCalls = []
        if (cand && cand.content && cand.content.parts) {
          cand.content.parts.forEach(function (p, i) {
            if (p.text) text += p.text
            else if (p.functionCall) toolCalls.push({ id: 'g_' + Date.now() + '_' + i, name: p.functionCall.name, args: p.functionCall.args || {} })
          })
        }
        return { text: text, toolCalls: toolCalls }
      })
  }

  function callLLM() {
    var p = state.llm.provider
    if (p === 'openai') return callOpenAI('https://api.openai.com/v1')()
    if (p === 'deepseek') return callOpenAI('https://api.deepseek.com/v1')()
    if (p === 'glm') return callOpenAI('https://open.bigmodel.cn/api/paas/v4')()
    if (p === 'qwen') return callOpenAI('https://dashscope-international.aliyuncs.com/compatible-mode/v1')()
    if (p === 'kimi') return callOpenAI('https://api.moonshot.cn/v1')()
    if (p === 'openrouter') return callOpenAI('https://openrouter.ai/api/v1')()
    if (p === 'siliconflow') return callOpenAI('https://api.siliconflow.com/v1')()
    if (p === 'anthropic') return callAnthropic()
    if (p === 'gemini') return callGemini()
    return Promise.reject(new Error('Unknown provider'))
  }

  // ======================================================================
  //  AGENT LOOP
  // ======================================================================
  var running = false
  function send() {
    var inputEl = $('input')
    var text = inputEl.value.trim()
    if (!text || running) return
    if (!state.llm.key) { banner('Add an LLM API key in the sidebar to start.'); return }
    inputEl.value = ''; autosize(inputEl)
    pushUser(text)
    runAgent()
  }

  function runAgent() {
    running = true
    setComposer(false)
    var thinking = addThinking()
    var steps = 0
    function step() {
      callLLM().then(function (res) {
        steps++
        // record assistant turn
        state.history.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls })
        if (res.text) addMessage('assistant', res.text)
        if (res.toolCalls && res.toolCalls.length && steps < 8) {
          // execute tools sequentially
          var i = 0
          function next() {
            if (i >= res.toolCalls.length) { step(); return }
            var tc = res.toolCalls[i++]
            var card = addToolCard(tc)
            executeTool(tc).then(function (result) {
              state.history.push({ role: 'tool', id: tc.id, name: tc.name, result: result })
              fillToolCard(card, result, false)
              next()
            }).catch(function (err) {
              var result = { error: err.message }
              state.history.push({ role: 'tool', id: tc.id, name: tc.name, result: result })
              fillToolCard(card, result, true)
              next()
            })
          }
          next()
        } else {
          finish()
        }
      }).catch(function (err) {
        addMessage('assistant', '⚠️ ' + err.message)
        finish()
      })
    }
    function finish() { thinking.remove(); running = false; setComposer(true); scrollDown() }
    step()
  }

  function executeTool(tc) {
    var tool = TOOLS[tc.name]
    if (!tool) return Promise.reject(new Error('Unknown tool: ' + tc.name))
    try { return Promise.resolve(tool.run(tc.args || {})) }
    catch (e) { return Promise.reject(e) }
  }

  // ======================================================================
  //  UI RENDERING
  // ======================================================================
  function clearEmpty() { var e = $('empty'); if (e) e.remove() }
  function pushUser(text) { state.history.push({ role: 'user', text: text }); addMessage('user', text) }
  function addMessage(role, text) {
    clearEmpty()
    var wrap = document.createElement('div')
    wrap.className = 'msg ' + role
    wrap.innerHTML = '<div class="role">' + (role === 'user' ? 'You' : 'EasyClaw') + '</div><div class="bubble">' + renderMarkdown(text) + '</div>'
    $('messages').appendChild(wrap); scrollDown(); return wrap
  }
  function addThinking() {
    clearEmpty()
    var el = document.createElement('div')
    el.className = 'msg assistant'
    el.innerHTML = '<div class="role">EasyClaw</div><div class="bubble">…thinking</div>'
    $('messages').appendChild(el); scrollDown(); return el
  }
  function addToolCard(tc) {
    var el = document.createElement('details')
    el.className = 'tool'; el.open = false
    el.innerHTML = '<summary>🔧 ' + esc(tc.name) + '(' + esc(JSON.stringify(tc.args || {})) + ')</summary><pre>running…</pre>'
    $('messages').appendChild(el); scrollDown(); return el
  }
  function fillToolCard(el, result, isErr) {
    var pre = el.querySelector('pre')
    pre.textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    if (isErr) { el.style.borderColor = 'rgba(251,113,133,0.4)'; el.open = true }
    scrollDown()
  }
  function scrollDown() { var m = $('messages'); m.scrollTop = m.scrollHeight }
  function setComposer(enabled) { $('send').disabled = !enabled; $('input').disabled = !enabled }
  function banner(msg) {
    var b = $('banner'); b.textContent = msg; b.style.display = 'block'
    setTimeout(function () { b.style.display = 'none' }, 5000)
  }
  function autosize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px' }

  // ======================================================================
  //  CONNECTION HANDLERS
  // ======================================================================
  function loadLlmFields() {
    var p = state.llm.provider
    $('llmProvider').value = p
    state.llm.key = LS.get('ec_llm_key_' + p, '')
    state.llm.model = LS.get('ec_llm_model_' + p, DEFAULT_MODEL[p])
    $('llmKey').value = state.llm.key
    $('llmModel').value = state.llm.model
    setDot('dot-llm', state.llm.key ? 'on' : '')
  }

  function initEvents() {
    $('originHint').textContent = location.origin

    $('llmProvider').addEventListener('change', function () {
      state.llm.provider = this.value; LS.set('ec_llm_provider', this.value); loadLlmFields(); status('llmStatus', '', '')
    })
    $('saveLlm').addEventListener('click', function () {
      var p = state.llm.provider
      state.llm.key = $('llmKey').value.trim()
      state.llm.model = $('llmModel').value.trim() || DEFAULT_MODEL[p]
      LS.set('ec_llm_key_' + p, state.llm.key); LS.set('ec_llm_model_' + p, state.llm.model)
      if (!state.llm.key) { setDot('dot-llm', ''); status('llmStatus', 'Key cleared.', ''); return }
      setDot('dot-llm', 'on'); status('llmStatus', 'Saved. Verifying…', '')
      verifyLlm().then(function () { status('llmStatus', '✓ ' + p + ' / ' + state.llm.model + ' ready', 'ok') })
        .catch(function (e) { setDot('dot-llm', 'err'); status('llmStatus', '✗ ' + e.message, 'err') })
    })

    $('saveGh').addEventListener('click', function () {
      state.gh.token = $('ghToken').value.trim()
      LS.set('ec_github_pat', state.gh.token)
      if (!state.gh.token) { setDot('dot-gh', ''); status('ghStatus', 'Token cleared.', ''); return }
      status('ghStatus', 'Connecting…', '')
      fetch('https://api.github.com/user', { headers: ghHeaders() }).then(checkJson).then(function (u) {
        state.gh.user = u.login; setDot('dot-gh', 'on'); status('ghStatus', '✓ Connected as ' + u.login, 'ok')
      }).catch(function (e) { setDot('dot-gh', 'err'); status('ghStatus', '✗ ' + e.message, 'err') })
    })

    $('saveFc').addEventListener('click', function () {
      state.fc.key = $('fcKey').value.trim(); LS.set('ec_firecrawl_key', state.fc.key)
      setDot('dot-fc', state.fc.key ? 'on' : ''); status('fcStatus', state.fc.key ? '✓ Key saved' : 'Key cleared.', state.fc.key ? 'ok' : '')
    })

    $('connectGm').addEventListener('click', connectGmail)

    $('allowWrites').addEventListener('change', function () {
      state.allowWrites = this.checked; LS.set('ec_allow_writes', this.checked ? '1' : '0')
    })

    $('send').addEventListener('click', send)
    $('input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    })
    $('input').addEventListener('input', function () { autosize(this) })

    var ex = $('examples')
    if (ex) ex.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return
      $('input').value = b.getAttribute('data-ex'); autosize($('input')); $('input').focus()
    })

    $('menuBtn').addEventListener('click', function () { $('sidebar').classList.toggle('open') })
  }

  function verifyLlm() {
    // lightweight: a 1-token ping per provider
    var p = state.llm.provider
    if (p === 'gemini') {
      return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + state.llm.model + '?key=' + encodeURIComponent(state.llm.key)).then(checkJson)
    }
    if (p === 'anthropic') {
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': state.llm.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: state.llm.model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
      }).then(checkJson)
    }
    var VERIFY_BASE = {
      openai: 'https://api.openai.com/v1',
      deepseek: 'https://api.deepseek.com/v1',
      glm: 'https://open.bigmodel.cn/api/paas/v4',
      qwen: 'https://dashscope-international.aliyuncs.com/compatible-mode/v1',
      kimi: 'https://api.moonshot.cn/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      siliconflow: 'https://api.siliconflow.com/v1'
    }
    var base = VERIFY_BASE[p] || 'https://api.openai.com/v1'
    return fetch(base + '/models', { headers: { Authorization: 'Bearer ' + state.llm.key } }).then(checkJson)
  }

  // ----- Gmail via Google Identity Services token client -----
  function connectGmail() {
    var clientId = $('gmClientId').value.trim()
    if (!clientId) { status('gmStatus', 'Enter your Google OAuth Client ID first.', 'err'); return }
    LS.set('ec_google_client_id', clientId); state.gm.clientId = clientId
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      status('gmStatus', 'Google library still loading — try again in a moment.', 'err'); return
    }
    status('gmStatus', 'Opening Google sign-in…', '')
    state.gm.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      callback: function (resp) {
        if (resp.error) { setDot('dot-gm', 'err'); status('gmStatus', '✗ ' + resp.error, 'err'); return }
        state.gm.token = resp.access_token
        fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + state.gm.token } })
          .then(checkJson).then(function (pr) {
            state.gm.email = pr.emailAddress; setDot('dot-gm', 'on'); status('gmStatus', '✓ Connected: ' + pr.emailAddress, 'ok')
          }).catch(function (e) { setDot('dot-gm', 'err'); status('gmStatus', '✗ ' + e.message, 'err') })
      }
    })
    state.gm.tokenClient.requestAccessToken()
  }

  // ----- restore saved connections on load -----
  function restore() {
    loadLlmFields()
    if (state.llm.key) status('llmStatus', 'Loaded saved key for ' + state.llm.provider + '.', '')

    state.gh.token = LS.get('ec_github_pat', '')
    if (state.gh.token) { $('ghToken').value = state.gh.token; setDot('dot-gh', 'on'); status('ghStatus', 'Saved token loaded (not re-verified).', '') }

    state.fc.key = LS.get('ec_firecrawl_key', '')
    if (state.fc.key) { $('fcKey').value = state.fc.key; setDot('dot-fc', 'on') }

    state.gm.clientId = LS.get('ec_google_client_id', '')
    if (state.gm.clientId) $('gmClientId').value = state.gm.clientId

    $('allowWrites').checked = state.allowWrites
  }

  document.addEventListener('DOMContentLoaded', function () { initEvents(); restore() })
})()
