(function(){
  "use strict";
  var BOOT_HASH = location.hash; // guarda o #... do link de recuperação antes de o Supabase limpar

  var state = { students: [], events: [], settings: { theme: 'manila' }, loaded: false };
  var currentView = "dashboard";
  var currentStudentId = null;
  var currentTab = "notas";
  var studentSearch = "";
  var turmaFilter = "";
  var eventCat = "", eventWhen = "next";

  function uid(){ return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8); }
  function escapeHtml(s){
    return (s == null ? "" : String(s)).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function formatDate(d){
    if(!d) return "—";
    var parts = d.split("-");
    if(parts.length !== 3) return d;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  var storageWarned = false;
  function storageFail(){
    if(storageWarned) return; storageWarned = true;
    toastErr('Não foi possível salvar na nuvem. Verifique a conexão e tente de novo. Se persistir, exporte um backup em Configurações.');
  }
  function parseGrade(v){
    var n = parseFloat(String(v).replace(',', '.'));
    return (isNaN(n) || n < 0 || n > 10) ? null : n;
  }
  function download(name, text, type){
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: type}));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function today(){ return new Date().toISOString().slice(0,10); }
  function attentionList(){
    var out = [];
    state.students.forEach(function(s){
      var m = studentAverage(s), f = attendanceSummary(s), why = [];
      if(m !== null && m < 5) why.push('média ' + m.toFixed(1).replace('.', ','));
      if(f.rate !== null && f.rate < 75) why.push('presença ' + f.rate + '%');
      if(why.length) out.push({nome: s.nome, turma: s.turma, why: why.join(' · ')});
    });
    return out;
  }
  function printReport(s){
    var w = window.open('', '_blank');
    if(!w){ toastErr('Libere pop-ups para imprimir o boletim.'); return; }
    var porDisc = {};
    (s.notas||[]).forEach(function(n){ var v = parseGrade(n.valor); if(v === null) return; (porDisc[n.disciplina] = porDisc[n.disciplina] || []).push(v); });
    var f = attendanceSummary(s), m = studentAverage(s);
    var rows = Object.keys(porDisc).sort().map(function(d){
      var a = porDisc[d]; var avg = a.reduce(function(x,y){return x+y;},0)/a.length;
      return '<tr><td>' + escapeHtml(d) + '</td><td>' + a.length + '</td><td>' + avg.toFixed(1).replace('.', ',') + '</td></tr>';
    }).join('') || '<tr><td colspan="3">Sem notas lançadas.</td></tr>';
    var obs = (s.observacoes||[]).slice().sort(function(a,b){return (a.data||'').localeCompare(b.data||'');}).map(function(o){
      return '<li>' + formatDate(o.data) + ' — ' + escapeHtml(o.texto) + '</li>'; }).join('');
    w.document.write('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Boletim — ' + escapeHtml(s.nome) + '</title><style>' +
      'body{font-family:Georgia,serif;max-width:720px;margin:2rem auto;color:#111;line-height:1.5}h1{margin:0}h2{font-size:1.05rem;border-bottom:1px solid #999;padding-bottom:.2rem;margin-top:1.6rem}' +
      'table{width:100%;border-collapse:collapse}td,th{border:1px solid #bbb;padding:.35rem .6rem;text-align:left}.sub{color:#555}</style></head><body>' +
      '<h1>Boletim do aluno</h1><div class="sub">ETE Antônio Arruda de Farias · emitido em ' + formatDate(today()) + '</div>' +
      '<h2>' + escapeHtml(s.nome) + ' — ' + escapeHtml(turmaLabel(s.turma)) + '</h2>' +
      '<p>Média geral: <b>' + (m === null ? '—' : m.toFixed(1).replace('.', ',')) + '</b> · Frequência: <b>' + (f.rate === null ? '—' : f.rate + '%') + '</b> (' + f.absent + ' faltas em ' + f.total + ' registros)</p>' +
      '<h2>Notas por disciplina</h2><table><tr><th>Disciplina</th><th>Lançamentos</th><th>Média</th></tr>' + rows + '</table>' +
      '<h2>Observações</h2>' + (obs ? '<ul>' + obs + '</ul>' : '<p>Nenhuma.</p>') +
      '<h2>Plano de melhoria</h2><p>' + (s.plano ? escapeHtml(s.plano).replace(/\n/g, '<br>') : 'Nenhum.') + '</p></body></html>');
    w.document.close(); w.focus(); setTimeout(function(){ w.print(); }, 300);
  }

  // ---------- TURMAS (3 séries x 4 turmas — A/B = ADM, C/D = DS) ----------
  var TURMAS = [];
  ['1º Ano', '2º Ano', '3º Ano'].forEach(function(serie){
    ['A', 'B', 'C', 'D'].forEach(function(letra){
      var curso = (letra === 'A' || letra === 'B') ? 'ADM' : 'DS';
      TURMAS.push({
        value: serie + ' ' + letra,
        serie: serie,
        letra: letra,
        curso: curso,
        label: serie + ' ' + letra + ' (' + curso + ')'
      });
    });
  });
  function turmaInfo(value){
    return TURMAS.find(function(t){ return t.value === value; });
  }
  function turmaLabel(value){
    var t = turmaInfo(value);
    return t ? t.label : 'Sem turma';
  }
  function turmaSelectOptions(selected){
    var html = '<option value="">Selecione a turma…</option>';
    ['1º Ano', '2º Ano', '3º Ano'].forEach(function(serie){
      html += '<optgroup label="' + serie + '">';
      TURMAS.filter(function(t){ return t.serie === serie; }).forEach(function(t){
        html += '<option value="' + t.value + '"' + (t.value === selected ? ' selected' : '') + '>' + t.label + '</option>';
      });
      html += '</optgroup>';
    });
    return html;
  }

  // ---------- NOTAS: faixa de cor e média ----------
  function gradeTier(valor){
    var n = parseFloat(String(valor).replace(',', '.'));
    if(isNaN(n)) return 'na';
    if(n >= 7) return 'good';
    if(n >= 5) return 'mid';
    return 'low';
  }
  function gradeTierLabel(tier){
    return {good:'boa', mid:'atenção', low:'baixa', na:'—'}[tier];
  }
  function studentAverage(s){
    var vals = (s.notas||[]).map(function(n){ return parseFloat(String(n.valor).replace(',', '.')); }).filter(function(v){ return !isNaN(v); });
    if(!vals.length) return null;
    return vals.reduce(function(a,b){ return a+b; }, 0) / vals.length;
  }
  function attendanceSummary(s){
    var records = s.frequencia || [];
    var present = records.filter(function(item){ return item.status === 'presente'; }).length;
    return { total: records.length, present: present, absent: records.length - present,
      rate: records.length ? Math.round(present / records.length * 100) : null };
  }

  // ---------- TEMAS ----------
  var THEMES = [
    {value:'manila', name:'Pasta Manila', colors:['#EBE2C9','#A3392A','#4C5D3F']},
    {value:'menta', name:'Papel Menta', colors:['#E7EFE4','#B24C3C','#3E7A54']},
    {value:'ardosia', name:'Ardósia', colors:['#232B2E','#E08A6B','#7FAE8E']},
    {value:'noturno', name:'Caderno Noturno', colors:['#1B2135','#E8836B','#7BC08F']},
    {value:'rose', name:'Rosa Antigo', colors:['#F2E4E1','#A3392A','#5B7856']}
  ];
  function applyTheme(theme){
    document.body.setAttribute('data-theme', theme === 'manila' ? '' : theme);
  }

  // ---------- STORAGE (Supabase) ----------
  var SB_URL = window.EDUNOTE_CONFIG.SB_URL;
  var SB_KEY = window.EDUNOTE_CONFIG.SB_KEY;
  var sb = window.supabase.createClient(SB_URL, SB_KEY);
  var currentUser = null, cloud = null;
  var COLS = {'edunote:students':'students', 'edunote:events':'events', 'edunote:settings':'settings'};
  var storage = {
    get: async function(key){
      var v = cloud ? cloud[COLS[key]] : null;
      return v == null ? null : { key: key, value: JSON.stringify(v) };
    },
    set: async function(key, value){
      if(!currentUser || !cloud) return null;
      var row = { user_id: currentUser.id, updated_at: new Date().toISOString() };
      row[COLS[key]] = JSON.parse(value);
      var r = await sb.from('edunote_data').upsert(row, { onConflict: 'user_id' });
      if(r.error){ console.error(r.error); storageFail(); return null; }
      storageWarned = false;
      cloud[COLS[key]] = row[COLS[key]];
      return { key: key, value: value };
    }
  };

  function setSaveStatus(saving){
    var el = document.getElementById('save-status');
    var label = document.getElementById('save-label');
    if(!el) return;
    if(saving){ el.classList.add('saving'); label.textContent = 'salvando…'; }
    else { el.classList.remove('saving'); label.textContent = 'dados salvos'; }
  }

  async function loadState(){
    try{
      var s = await storage.get('edunote:students');
      var e = await storage.get('edunote:events');
      var st = await storage.get('edunote:settings');
      state.students = s && s.value ? JSON.parse(s.value) : [];
      state.events = e && e.value ? JSON.parse(e.value) : [];
      state.settings = st && st.value ? JSON.parse(st.value) : { theme: 'manila' };
    } catch(err){
      console.error('Erro ao carregar dados', err);
      state.students = state.students || [];
      state.events = state.events || [];
      state.settings = state.settings || { theme: 'manila' };
    }
    applyTheme(state.settings.theme || 'manila');
    state.loaded = true;
  }

  async function saveSettings(){
    setSaveStatus(true);
    try{
      await storage.set('edunote:settings', JSON.stringify(state.settings));
    } catch(err){ console.error('Erro ao salvar configurações', err); }
    setSaveStatus(false);
  }


  async function saveStudents(){
    setSaveStatus(true);
    try{
      await storage.set('edunote:students', JSON.stringify(state.students));
    } catch(err){ console.error('Erro ao salvar alunos', err); }
    setSaveStatus(false);
  }
  async function saveEvents(){
    setSaveStatus(true);
    try{
      await storage.set('edunote:events', JSON.stringify(state.events));
    } catch(err){ console.error('Erro ao salvar eventos', err); }
    setSaveStatus(false);
  }

  // ---------- PERSONALIZAÇÃO (cores, categorias, ordenação) ----------
  var PALETTE = ['#A3392A','#C0902F','#4A6FA5','#5E8C61','#7A5AA6','#C0627A','#2F8F9D','#7A7A8C'];
  var CATS = [{v:'prova',l:'Prova',c:'#A3392A'},{v:'trabalho',l:'Trabalho',c:'#C0902F'},{v:'reuniao',l:'Reunião',c:'#4A6FA5'},{v:'feriado',l:'Feriado / recesso',c:'#5E8C61'},{v:'outro',l:'Outro',c:'#7A7A8C'}];
  var MESES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  function catOf(v){ return CATS.filter(function(c){ return c.v === v; })[0] || CATS[4]; }
  function catOptions(sel){ return CATS.map(function(c){ return '<option value="' + c.v + '"' + (c.v === sel ? ' selected' : '') + '>' + c.l + '</option>'; }).join(''); }
  function selOpt(v, l, cur){ return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + l + '</option>'; }
  function hashColor(str){ var h = 0; for(var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; }
  function initials(n){ var p = n.trim().split(/\s+/); return ((p[0] || '').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase(); }
  function swatchesHtml(sel){ return '<div class="swatches">' + PALETTE.map(function(c){ return '<button type="button" class="sw' + (c === sel ? ' sel' : '') + '" data-c="' + c + '" style="background:' + c + '" aria-label="Cor"></button>'; }).join('') + '</div>'; }
  function wireSwatches(root){ root.querySelectorAll('.sw').forEach(function(b){ b.addEventListener('click', function(){ root.querySelectorAll('.sw').forEach(function(x){ x.classList.remove('sel'); }); b.classList.add('sel'); }); }); }
  function pickedColor(root, fb){ var s = root.querySelector('.sw.sel'); return s ? s.getAttribute('data-c') : fb; }
  function sortStudents(list){
    var o = state.settings.alunosOrdem || 'nome';
    var pend = function(s){ return (s.tarefas || []).filter(function(t){ return !t.concluida; }).length; };
    var key = {
      media: function(s){ var m = studentAverage(s); return -(m === null ? -1 : m); },
      mediaAsc: function(s){ var m = studentAverage(s); return m === null ? 11 : m; },
      tarefas: function(s){ return -pend(s); },
      freq: function(s){ var r = attendanceSummary(s).rate; return r === null ? 101 : r; }
    }[o];
    list.sort(function(a, b){ var d = key ? key(a) - key(b) : 0; return d || a.nome.localeCompare(b.nome, 'pt-BR', {sensitivity: 'base'}); });
  }
  function studentToolbarExtra(){
    var o = state.settings.alunosOrdem || 'nome', v = state.settings.alunosVisao || 'cards';
    return '<select class="search-input" id="al-ordem" style="flex:none; width:auto;">' + selOpt('nome', 'Ordem: nome A–Z', o) + selOpt('media', 'Maior média', o) + selOpt('mediaAsc', 'Menor média', o) + selOpt('tarefas', 'Mais tarefas pendentes', o) + selOpt('freq', 'Menor presença', o) + '</select>' +
      '<select class="search-input" id="al-visao" style="flex:none; width:auto;">' + selOpt('cards', 'Visual: cards', v) + selOpt('lista', 'Visual: lista', v) + '</select>';
  }

  // ---------- DIÁLOGOS, AVISOS E GRUPOS ----------
  function dialog(o){
    return new Promise(function(resolve){
      var back = document.getElementById('dlg');
      back.querySelector('.dlg').className = 'dlg' + (o.wide ? ' wide' : '');
      document.getElementById('dlg-title').textContent = o.title || '';
      var body = document.getElementById('dlg-body');
      body.innerHTML = o.html || ('<p>' + escapeHtml(o.text || '') + '</p>');
      var act = document.getElementById('dlg-actions'); act.innerHTML = '';
      function close(v){ back.classList.add('hidden'); document.removeEventListener('keydown', onKey, true); resolve(v); }
      function onKey(e){ if(e.key === 'Escape'){ e.stopPropagation(); close(null); } }
      if(o.cancel !== false){
        var cb = document.createElement('button'); cb.type = 'button'; cb.className = 'btn'; cb.textContent = 'Cancelar';
        cb.onclick = function(){ close(null); }; act.appendChild(cb);
      }
      var ok = document.createElement('button'); ok.type = 'button';
      ok.className = 'btn ' + (o.danger ? 'btn-danger-solid' : 'btn-primary'); ok.textContent = o.ok || 'OK';
      ok.onclick = function(){ var v = o.collect ? o.collect(body) : true; if(v === undefined) return; close(v); };
      act.appendChild(ok);
      body.onkeydown = function(e){ if(e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox'){ e.preventDefault(); ok.click(); } };
      back.onclick = function(e){ if(e.target === back) close(null); };
      document.addEventListener('keydown', onKey, true);
      back.classList.remove('hidden');
      (body.querySelector('input[type=text],input[type=number],select') || ok).focus();
    });
  }
  function confirmBox(text, o){
    o = o || {};
    return dialog({title: o.title || 'Confirmar ação', text: text, ok: o.ok || 'Confirmar', danger: o.danger}).then(function(v){ return v === true; });
  }
  function toast(msg, kind){
    var t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(function(){ t.classList.add('out'); setTimeout(function(){ t.remove(); }, 300); }, 3800);
  }
  function toastErr(m){ toast(m, 'err'); }

  function groupsList(){ if(!Array.isArray(state.settings.grupos)) state.settings.grupos = []; return state.settings.grupos; }
  function fieldVal(b, name){ return b.querySelector('[data-f=' + name + ']'); }
  function shuffle(a){ for(var i = a.length - 1; i > 0; i--){ var k = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[k]; a[k] = t; } return a; }
  // Sorteia: com "balance", distribui em zigue-zague pela média para misturar níveis.
  function drawGroups(arr, size, balance, avg){
    var n = Math.min(arr.length, Math.max(1, Math.round(arr.length / size)));
    var groups = []; for(var i = 0; i < n; i++) groups.push([]);
    var list = shuffle(arr.slice());
    if(balance){
      list.sort(function(a, b){ return avg(b) - avg(a); });
      list.forEach(function(s, i){ var r = Math.floor(i / n), p = i % n; groups[r % 2 === 0 ? p : n - 1 - p].push(s.id); });
    } else list.forEach(function(s, i){ groups[i % n].push(s.id); });
    return groups;
  }
  function renderGroups(){
    var gs = groupsList().slice().sort(function(a, b){ return ((a.atividade||'') + a.nome).localeCompare((b.atividade||'') + b.nome, 'pt-BR', {numeric: true}); });
    return '<div class="view-head"><div><p class="eyebrow">Trabalhos em equipe</p><h2>Grupos</h2></div>' +
      '<div style="display:flex; gap:0.6rem; flex-wrap:wrap;">' + (gs.length ? '<button class="btn" id="btn-clear-groups">Limpar grupos</button>' : '') +
      '<button class="btn" id="btn-draw-groups">Sortear grupos</button><button class="btn btn-primary" id="btn-new-group">Novo grupo</button></div></div>' +
      (gs.length ? gs.map(function(g){
        var ms = (g.alunos || []).map(getStudent).filter(Boolean);
        var avs = ms.map(studentAverage).filter(function(v){ return v !== null; });
        var gm = avs.length ? ' · média ' + (avs.reduce(function(x, y){ return x + y; }, 0) / avs.length).toFixed(1).replace('.', ',') : '';
        return '<div class="panel-box group-card" style="--gc:' + (g.cor || hashColor(g.nome)) + '"><div class="group-head"><div><h3>' + (g.emoji ? '<span class="g-emoji">' + g.emoji + '</span> ' : '') + escapeHtml(g.nome) + '</h3><div class="meta">' +
          (g.atividade ? escapeHtml(g.atividade) + ' · ' : '') + ms.length + ' aluno(s)' + gm + '</div></div>' +
          '<div class="actions"><button class="icon-btn" data-gedit="' + g.id + '" title="Editar">✎</button><button class="icon-btn" data-gdel="' + g.id + '" title="Excluir">✕</button></div></div>' +
          '<div class="chips">' + ms.map(function(m){ return '<span class="chip' + (m.id === g.lider ? ' lead' : '') + '"><i class="dot-cat" style="background:' + (m.cor || hashColor(m.nome)) + '"></i>' + (m.id === g.lider ? '★ ' : '') + escapeHtml(m.nome) + ' <span class="meta">' + escapeHtml(turmaLabel(m.turma)) + '</span></span>'; }).join('') + '</div></div>';
      }).join('') : '<p class="empty">Nenhum grupo ainda. Crie um grupo escolhendo os alunos, ou sorteie vários de uma vez a partir de uma turma.</p>');
  }
  function openGroupForm(g){
    var sorted = state.students.slice().sort(function(a, b){ return a.nome.localeCompare(b.nome, 'pt-BR'); });
    if(!sorted.length){ toast('Cadastre alunos antes de criar grupos.', 'err'); return; }
    var chosen = {}; (g ? g.alunos : []).forEach(function(id){ chosen[id] = true; });
    var p = dialog({title: g ? 'Editar grupo' : 'Novo grupo', wide: true, ok: 'Salvar',
      html: '<div class="field"><label>Nome do grupo</label><input type="text" data-f="nome" value="' + escapeHtml(g ? g.nome : '') + '"></div>' +
        '<div class="field"><label>Atividade (opcional)</label><input type="text" data-f="atividade" value="' + escapeHtml(g && g.atividade || '') + '"></div>' +
        '<div class="field"><label>Ícone</label><select data-f="emoji">' + ['', '📚', '🔬', '🎨', '💡', '🚀', '⚽', '🎭', '🌱', '🧮'].map(function(e){ return selOpt(e, e || 'Sem ícone', g && g.emoji || ''); }).join('') + '</select></div>' +
        '<div class="field"><label>Cor do grupo</label>' + swatchesHtml(g && g.cor || PALETTE[groupsList().length % PALETTE.length]) + '</div>' +
        '<div class="field"><label>Líder (opcional)</label><select id="g-lider"></select></div>' +
        '<div class="field"><label>Filtrar alunos por turma</label><select id="g-turma">' + turmaSelectOptions('') + '</select></div>' +
        '<div class="pick" id="g-pick"></div><p class="meta" id="g-count" style="margin-top:0.5rem;"></p>',
      collect: function(b){
        var nome = fieldVal(b, 'nome').value.trim(), ids = Object.keys(chosen).filter(function(k){ return chosen[k]; });
        if(!nome || !ids.length){ toast('Dê um nome ao grupo e marque ao menos um aluno.', 'err'); return undefined; }
        return {nome: nome, atividade: fieldVal(b, 'atividade').value.trim(), alunos: ids, emoji: fieldVal(b, 'emoji').value, cor: pickedColor(b, ''), lider: ids.indexOf(document.getElementById('g-lider').value) !== -1 ? document.getElementById('g-lider').value : ''};
      }});
    var sel = document.getElementById('g-turma'); sel.options[0].textContent = 'Todas as turmas';
    var leader = g && g.lider || ''; wireSwatches(document.getElementById('dlg-body'));
    function count(){
      var ids = Object.keys(chosen).filter(function(k){ return chosen[k]; }), ls = document.getElementById('g-lider');
      document.getElementById('g-count').textContent = ids.length + ' aluno(s) selecionado(s)';
      leader = ls.value || leader;
      ls.innerHTML = '<option value="">Sem líder</option>' + ids.map(function(id){ var s = getStudent(id); return s ? '<option value="' + id + '"' + (id === leader ? ' selected' : '') + '>' + escapeHtml(s.nome) + '</option>' : ''; }).join('');
    }
    function paint(){
      var t = sel.value;
      document.getElementById('g-pick').innerHTML = sorted.filter(function(s){ return !t || s.turma === t; }).map(function(s){
        return '<label class="pick-row"><input type="checkbox" data-id="' + s.id + '"' + (chosen[s.id] ? ' checked' : '') + '> ' + escapeHtml(s.nome) + ' <span class="meta">' + escapeHtml(turmaLabel(s.turma)) + '</span></label>';
      }).join(''); count();
    }
    document.getElementById('g-pick').addEventListener('change', function(e){ if(e.target.getAttribute('data-id')){ chosen[e.target.getAttribute('data-id')] = e.target.checked; count(); } });
    sel.addEventListener('change', paint); paint();
    p.then(function(v){
      if(!v) return;
      if(g){ g.nome = v.nome; g.atividade = v.atividade; g.alunos = v.alunos; g.emoji = v.emoji; g.cor = v.cor; g.lider = v.lider; }
      else groupsList().push({id: uid(), nome: v.nome, atividade: v.atividade, alunos: v.alunos, emoji: v.emoji, cor: v.cor, lider: v.lider});
      saveSettings(); render(); toast('Grupo salvo.');
    });
  }
  function openDrawForm(){
    if(state.students.length < 2){ toast('Cadastre pelo menos 2 alunos.', 'err'); return; }
    dialog({title: 'Sortear grupos', ok: 'Sortear',
      html: '<div class="field"><label>Turma</label><select data-f="turma">' + turmaSelectOptions('') + '</select></div>' +
        '<div class="field"><label>Alunos por grupo</label><input type="number" data-f="size" min="2" max="12" value="4"></div>' +
        '<div class="field"><label>Atividade (opcional)</label><input type="text" data-f="atividade"></div>' +
        '<label class="pick-row"><input type="checkbox" data-f="balance" checked> Misturar níveis (equilibrar pela média das notas)</label>',
      collect: function(b){
        var t = fieldVal(b, 'turma').value, size = parseInt(fieldVal(b, 'size').value, 10);
        if(!t){ toast('Escolha a turma.', 'err'); return undefined; }
        if(!(size >= 2)){ toast('Informe 2 ou mais alunos por grupo.', 'err'); return undefined; }
        var arr = state.students.filter(function(s){ return s.turma === t; });
        if(arr.length < 2){ toast('Essa turma tem menos de 2 alunos.', 'err'); return undefined; }
        return {arr: arr, size: size, balance: fieldVal(b, 'balance').checked, atividade: fieldVal(b, 'atividade').value.trim()};
      }}).then(function(v){
      if(!v) return;
      var all = v.arr.map(studentAverage).filter(function(x){ return x !== null; });
      var mean = all.length ? all.reduce(function(x, y){ return x + y; }, 0) / all.length : 0;
      var gr = drawGroups(v.arr, v.size, v.balance, function(s){ var a = studentAverage(s); return a === null ? mean : a; });
      gr.forEach(function(ids, i){ groupsList().push({id: uid(), nome: 'Grupo ' + (i + 1), atividade: v.atividade, alunos: ids, cor: PALETTE[i % PALETTE.length]}); });
      saveSettings(); render(); toast(gr.length + ' grupos criados.');
    });
  }

  // ---------- NAV ----------
  document.querySelectorAll('.nav-item').forEach(function(item){
    item.addEventListener('click', function(){
      currentView = item.getAttribute('data-view');
      document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });
      item.classList.add('active');
      render();
    });
  });

  function getStudent(id){
    return state.students.find(function(s){ return s.id === id; });
  }

  function updateCounts(){
    document.getElementById('count-students').textContent = state.students.length;
    document.getElementById('count-events').textContent = state.events.length;
    document.getElementById('count-groups').textContent = groupsList().length;
  }

  // ---------- RENDER ROOT ----------
  function render(){
    updateCounts();
    var main = document.getElementById('main');
    if(!state.loaded){
      main.innerHTML = '<p class="empty">Carregando dados…</p>';
      return;
    }
    if(currentView === 'dashboard') main.innerHTML = renderDashboard();
    else if(currentView === 'students') main.innerHTML = renderStudents();
    else if(currentView === 'events') main.innerHTML = renderEvents();
    else if(currentView === 'groups') main.innerHTML = renderGroups();
    else if(currentView === 'settings') main.innerHTML = renderSettings();
    attachViewHandlers();
  }

  // ---------- DASHBOARD ----------
  function renderDashboard(){
    var totalAlunos = state.students.length;
    var totalTarefasPendentes = 0, totalNotas = 0, totalObs = 0, totalPresencas = 0, totalFaltas = 0;
    state.students.forEach(function(s){
      totalTarefasPendentes += (s.tarefas||[]).filter(function(t){ return !t.concluida; }).length;
      totalNotas += (s.notas||[]).length;
      totalObs += (s.observacoes||[]).length;
      var frequencia = attendanceSummary(s);
      totalPresencas += frequencia.present;
      totalFaltas += frequencia.absent;
    });
    var totalRegistrosFrequencia = totalPresencas + totalFaltas;
    var taxaFrequencia = totalRegistrosFrequencia ? Math.round(totalPresencas / totalRegistrosFrequencia * 100) + '%' : '—';
    var today = new Date().toISOString().slice(0,10);
    var proximosEventos = state.events.slice().filter(function(e){ return e.data >= today; })
      .sort(function(a,b){ return a.data.localeCompare(b.data); }).slice(0,5);

    var pendentesList = [];
    state.students.forEach(function(s){
      (s.tarefas||[]).forEach(function(t){
        if(!t.concluida) pendentesList.push({aluno:s.nome, descricao:t.descricao, prazo:t.prazo});
      });
    });
    pendentesList.sort(function(a,b){ return (a.prazo||'').localeCompare(b.prazo||''); });
    pendentesList = pendentesList.slice(0,5);

    var dt = new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'});
    var tiers = {boa: 0, mid: 0, baixa: 0, sem: 0}, byTurma = {};
    state.students.forEach(function(s){
      var m = studentAverage(s);
      tiers[m === null ? 'sem' : m >= 7 ? 'boa' : m >= 5 ? 'mid' : 'baixa']++;
      byTurma[s.turma] = (byTurma[s.turma] || 0) + 1;
    });
    var tl = [['boa', 'Média 7 ou mais', 'var(--sage)'], ['mid', 'Média 5 a 7', 'var(--gold)'], ['baixa', 'Abaixo de 5', 'var(--correction)'], ['sem', 'Sem notas', 'var(--card-edge)']];
    var tr = Object.keys(byTurma).sort(function(a, b){ return byTurma[b] - byTurma[a]; }).slice(0, 6), mx = tr.length ? byTurma[tr[0]] : 1;
    var att = attentionList();
    return '' +
    '<div class="hero"><div><p class="eyebrow">Painel</p><h2>Visão geral</h2></div><div class="hero-date">' + dt + '</div></div>' +
    '<div class="stat-grid">' +
      statCard('Alunos', totalAlunos, 'Cadastrados', '👥', '#4A6FA5') +
      statCard('Tarefas', totalTarefasPendentes, 'Pendentes', '📝', '#C0902F') +
      statCard('Notas', totalNotas, 'Lançadas', '📊', '#7A5AA6') +
      statCard('Frequência', taxaFrequencia, totalFaltas + ' faltas · ' + totalRegistrosFrequencia + ' registros', '✅', '#5E8C61') +
      statCard('Observações', totalObs, 'Registradas', '💬', '#A3392A') +
    '</div>' +
    '<div class="panel-cols">' +
      '<div class="panel-box"><h3>📈 Panorama das médias</h3>' +
        (totalAlunos ? '<div class="dist">' + tl.map(function(t){ return tiers[t[0]] ? '<span style="flex:' + tiers[t[0]] + '; background:' + t[2] + '"></span>' : ''; }).join('') + '</div>' +
          '<div class="legend">' + tl.map(function(t){ return '<div><i style="background:' + t[2] + '"></i>' + t[1] + ' <b>' + tiers[t[0]] + '</b></div>'; }).join('') + '</div>'
          : '<p class="empty">Cadastre alunos para ver o panorama.</p>') +
      '</div>' +
      '<div class="panel-box"><h3>🏫 Alunos por turma</h3>' +
        (tr.length ? tr.map(function(k){ return '<div class="hbar"><span class="lbl">' + escapeHtml(turmaLabel(k)) + '</span><span class="track"><span class="fill" style="width:' + Math.round(byTurma[k] / mx * 100) + '%"></span></span><span class="n">' + byTurma[k] + '</span></div>'; }).join('') : '<p class="empty">Nenhum aluno cadastrado.</p>') +
      '</div>' +
      '<div class="panel-box"><h3>📅 Próximos eventos</h3>' +
        (proximosEventos.length ? proximosEventos.map(function(e){
          return '<div class="row-line"><span><i class="dot-cat" style="background:' + catOf(e.categoria).c + '"></i>' + escapeHtml(e.titulo) + (e.turma ? ' <span class="meta">· ' + escapeHtml(e.turma) + '</span>' : '') + '</span><span class="meta">' + formatDate(e.data) + '</span></div>';
        }).join('') : '<p class="empty">Nenhum evento futuro cadastrado.</p>') +
      '</div>' +
      '<div class="panel-box"><h3>✏️ Tarefas pendentes</h3>' +
        (pendentesList.length ? pendentesList.map(function(t){
          return '<div class="row-line' + (t.prazo && t.prazo < today ? ' late' : '') + '"><span>' + escapeHtml(t.descricao) + ' <span class="meta">· ' + escapeHtml(t.aluno) + '</span></span><span class="meta">' + (t.prazo && t.prazo < today ? 'atrasada · ' : '') + formatDate(t.prazo) + '</span></div>';
        }).join('') : '<p class="empty">Nenhuma tarefa pendente. 🎉</p>') +
      '</div>' +
      '<div class="panel-box" style="grid-column:1/-1;"><h3>⚠️ Alunos em atenção</h3>' +
        (att.length ? att.map(function(a){
          return '<div class="row-line warn-row"><span>' + escapeHtml(a.nome) + ' <span class="meta">· ' + escapeHtml(turmaLabel(a.turma)) + '</span></span><span class="meta">' + a.why + '</span></div>';
        }).join('') : '<p class="empty">Nenhum aluno com média abaixo de 5 ou presença abaixo de 75%.</p>') +
      '</div>' +
    '</div>';
  }
  function statCard(tab, num, label, icon, color){
    return '<div class="stat-card" style="--acc:' + color + '"><span class="ico">' + icon + '</span><div><div class="stat-name">' + escapeHtml(tab) + '</div><div class="num">' + num + '</div><div class="label">' + escapeHtml(label) + '</div></div></div>';
  }

  // ---------- STUDENTS LIST ----------
  function renderStudents(){
    var q = studentSearch.toLowerCase();
    var list = state.students.filter(function(s){
      var matchesSearch = !q || s.nome.toLowerCase().indexOf(q) !== -1 || turmaLabel(s.turma).toLowerCase().indexOf(q) !== -1;
      var matchesTurma = !turmaFilter || s.turma === turmaFilter;
      return matchesSearch && matchesTurma;
    });
    sortStudents(list);

    var turmaOptions = '<option value="">Todas as turmas</option>';
    ['1º Ano', '2º Ano', '3º Ano'].forEach(function(serie){
      turmaOptions += '<optgroup label="' + serie + '">';
      TURMAS.filter(function(t){ return t.serie === serie; }).forEach(function(t){
        turmaOptions += '<option value="' + t.value + '"' + (t.value === turmaFilter ? ' selected' : '') + '>' + t.label + '</option>';
      });
      turmaOptions += '</optgroup>';
    });

    var body;
    if(!list.length){
      body = '<p class="empty">Nenhum aluno encontrado.</p>';
    } else if(turmaFilter){
      // uma turma específica selecionada: grade única, sem cabeçalhos
      body = '<div class="student-grid' + (state.settings.alunosVisao === 'lista' ? ' list' : '') + '">' + list.map(renderStudentCard).join('') + '</div>';
    } else {
      // "todas as turmas": agrupar por turma, só mostrando grupos com alunos
      var groups = {};
      list.forEach(function(s){
        var key = s.turma || '';
        groups[key] = groups[key] || [];
        groups[key].push(s);
      });
      var orderedKeys = TURMAS.map(function(t){ return t.value; }).filter(function(k){ return groups[k]; });
      if(groups['']) orderedKeys.push('');
      body = orderedKeys.map(function(key){
        return '<div class="turma-group">' +
          '<h3 class="turma-group-title">' + escapeHtml(turmaLabel(key)) + ' <span class="meta">· ' + groups[key].length + ' aluno' + (groups[key].length !== 1 ? 's' : '') + '</span></h3>' +
          '<div class="student-grid' + (state.settings.alunosVisao === 'lista' ? ' list' : '') + '">' + groups[key].map(renderStudentCard).join('') + '</div>' +
        '</div>';
      }).join('');
    }

    return '' +
    '<div class="view-head"><div><p class="eyebrow">Alunos</p><h2>Fichas dos alunos</h2></div>' +
      '<button class="btn btn-primary" id="btn-new-student">+ Novo aluno</button>' +
    '</div>' +
    '<div class="toolbar">' +
      '<input class="search-input" id="student-search" placeholder="Buscar por nome ou turma…" value="' + escapeHtml(studentSearch) + '">' +
      '<select class="search-input" id="turma-filter" style="flex:none; width:auto;">' + turmaOptions + '</select>' + studentToolbarExtra() +
    '</div>' +
    body;
  }

  function renderStudentCard(s){
    var pendentes = (s.tarefas||[]).filter(function(t){ return !t.concluida; }).length;
    var media = studentAverage(s);
    var frequencia = attendanceSummary(s);
    var mediaTier = media === null ? 'na' : gradeTier(media);
    return '<div class="student-card" data-id="' + s.id + '" style="--av:' + (s.cor || hashColor(s.nome)) + '">' +
      '<div class="sc-top"><span class="avatar">' + escapeHtml(initials(s.nome)) + '</span>' +
        '<div class="sc-name"><h4>' + escapeHtml(s.nome) + '</h4><span class="turma">' + escapeHtml(turmaLabel(s.turma)) + '</span></div>' +
        '<span class="grade-badge grade-' + mediaTier + '">' + (media === null ? '—' : media.toFixed(1)) + '</span>' +
      '</div>' +
      '<div class="mini-stats">' +
        '<span><b>' + (s.notas||[]).length + '</b> notas</span>' +
        '<span><b>' + pendentes + '</b> tarefas</span>' +
        '<span><b>' + (s.observacoes||[]).length + '</b> obs.</span>' +
        '<span><b>' + (frequencia.rate === null ? '—' : frequencia.rate + '%') + '</b> presença</span>' +
      '</div>' +
    '</div>';
  }

  // ---------- SETTINGS ----------
  function renderSettings(){
    var current = state.settings.theme || 'manila';
    return '' +
    '<div class="view-head"><div><p class="eyebrow">Configurações</p><h2>Aparência e critérios</h2></div></div>' +
    '<div class="settings-block">' +
      '<h3>Tema</h3>' +
      '<div class="theme-grid">' +
        THEMES.map(function(t){
          return '<div class="theme-card' + (t.value===current?' active':'') + '" data-theme-choice="' + t.value + '">' +
            '<div class="theme-preview">' + t.colors.map(function(c){ return '<span style="background:' + c + '"></span>'; }).join('') + '</div>' +
            '<div class="theme-info"><div class="name">' + t.name + '</div><div class="check">✓ selecionado</div></div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<div class="settings-block">' +
      '<h3>Cores por faixa de nota</h3>' +
      '<div class="legend-row"><span class="grade-badge grade-good">≥ 7,0</span> nota boa</div>' +
      '<div class="legend-row"><span class="grade-badge grade-mid">5,0 – 6,9</span> atenção</div>' +
      '<div class="legend-row"><span class="grade-badge grade-low">&lt; 5,0</span> nota baixa</div>' +
      '<p class="empty" style="margin-top:0.5rem;">As notas lançadas na ficha de cada aluno e a média mostrada no card do aluno seguem automaticamente essas cores.</p>' +
    '</div>' +
    '<div class="settings-block">' +
      '<h3>Dados e backup</h3>' +
      '<p class="empty" style="margin-bottom:0.8rem;">Seus dados ficam salvos na nuvem, na sua conta, e aparecem em qualquer computador depois do login. O backup é uma cópia extra de segurança.</p>' +
      '<div style="display:flex; gap:0.6rem; flex-wrap:wrap;">' +
        '<button class="btn" id="btn-export">Exportar backup (JSON)</button>' +
        '<button class="btn" id="btn-import">Importar backup</button>' +
        '<button class="btn" id="btn-csv">Exportar planilha (CSV)</button>' +
        '<button class="btn btn-danger" id="btn-wipe">Apagar todos os dados</button>' +
        '<input type="file" id="file-import" class="file-hidden" accept=".json,application/json">' +
      '</div>' +
    '</div>';
  }

  // ---------- EVENTS ----------
  function renderEvents(){
    var t = today();
    var list = state.events.filter(function(e){
      return (!eventCat || (e.categoria || 'outro') === eventCat) && (eventWhen === 'all' || (eventWhen === 'next' ? e.data >= t : e.data < t));
    }).sort(function(a, b){ return eventWhen === 'past' ? b.data.localeCompare(a.data) : a.data.localeCompare(b.data); });
    return '' +
    '<div class="view-head"><div><p class="eyebrow">Calendário</p><h2>Eventos</h2></div></div>' +
    '<div class="panel-box" style="margin-bottom:1.4rem;">' +
      '<h3>Novo evento</h3>' +
      '<form id="form-new-event" class="add-form">' +
        '<div class="field"><label>Título</label><input type="text" id="ev-titulo" required></div>' +
        '<div class="field"><label>Data</label><input type="date" id="ev-data" required></div>' +
        '<div class="field"><label>Categoria</label><select id="ev-cat">' + catOptions('prova') + '</select></div>' +
        '<div class="field"><label>Turma (opcional)</label><select id="ev-turma">' + turmaSelectOptions('') + '</select></div>' +
        '<button class="btn btn-primary btn-sm" type="submit">Adicionar</button>' +
      '</form>' +
    '</div>' +
    '<div class="fchips"><button class="fchip' + (!eventCat ? ' on' : '') + '" data-ecat="">Todas</button>' +
      CATS.map(function(c){ return '<button class="fchip' + (eventCat === c.v ? ' on' : '') + '" data-ecat="' + c.v + '">' + c.l + '</button>'; }).join('') +
      '<select class="search-input" id="ev-when" style="flex:none; width:auto; min-width:0; margin-left:auto;">' + selOpt('next', 'Próximos', eventWhen) + selOpt('past', 'Já passaram', eventWhen) + selOpt('all', 'Todos', eventWhen) + '</select></div>' +
    (list.length ? list.map(function(e){
      var cat = catOf(e.categoria);
      return '<div class="item-row ev-row" style="--cc:' + cat.c + '"><div class="date-badge"><b>' + e.data.slice(8, 10) + '</b><span>' + MESES[+e.data.slice(5, 7) - 1] + '</span></div>' +
        '<div class="info" style="flex:1;">' + escapeHtml(e.titulo) + '<span class="cat-tag">' + cat.l + '</span>' +
        (e.turma ? ' <span class="meta">· ' + escapeHtml(turmaLabel(e.turma)) + '</span>' : '') + '<div class="meta">' + formatDate(e.data) + '</div></div>' +
        '<div class="actions"><button class="icon-btn" data-edit-event="' + e.id + '" title="Editar">✎</button><button class="icon-btn" data-del-event="' + e.id + '" title="Excluir">✕</button></div></div>';
    }).join('') : '<p class="empty">Nenhum evento nesse filtro.</p>');
  }

  // ---------- STUDENT DETAIL MODAL ----------
  function openStudentDetail(id){
    currentStudentId = id;
    currentTab = 'notas';
    renderStudentModal();
    document.getElementById('overlay').classList.remove('hidden');
  }
  function closeModal(){
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('overlay').innerHTML = '';
    currentStudentId = null;
  }

  function renderStudentModal(){
    var s = getStudent(currentStudentId);
    var overlay = document.getElementById('overlay');
    if(!s){ closeModal(); return; }
    overlay.className = 'overlay';
    overlay.innerHTML =
      '<div class="modal">' +
        '<button class="modal-close" id="modal-close">×</button>' +
        '<div class="detail-head">' +
          '<div><h2>' + escapeHtml(s.nome) + '</h2><div class="detail-turma">' + escapeHtml(turmaLabel(s.turma)) + '</div></div>' +
        '</div>' +
        '<div style="display:flex; gap:0.5rem; margin-top:0.8rem;">' +
          '<button class="btn btn-sm" id="btn-edit-student">Editar dados</button>' +
          '<button class="btn btn-sm" id="btn-print-student">Imprimir boletim</button>' +
          '<button class="btn btn-sm btn-danger" id="btn-del-student">Excluir aluno</button>' +
        '</div>' +
        '<div class="tabs">' +
          tabBtn('notas','Notas') + tabBtn('tarefas','Tarefas') + tabBtn('frequencia','Frequência') + tabBtn('observacoes','Observações') + tabBtn('plano','Plano de melhoria') +
        '</div>' +
        '<div id="tab-body"></div>' +
      '</div>';
    renderTabBody();
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-del-student').addEventListener('click', function(){
      confirmBox('Excluir ' + s.nome + ' e todos os seus registros? Isso não pode ser desfeito.', {title: 'Excluir aluno', ok: 'Excluir', danger: true}).then(function(ok){
        if(!ok) return;
        state.students = state.students.filter(function(x){ return x.id !== s.id; });
        saveStudents();
        closeModal();
        render();
        toast('Aluno excluído.');
      });
    });
    document.getElementById('btn-print-student').addEventListener('click', function(){ printReport(s); });
    document.getElementById('btn-edit-student').addEventListener('click', function(){
      openStudentForm(s);
    });
    overlay.querySelectorAll('.tab-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        currentTab = btn.getAttribute('data-tab');
        renderStudentModal();
      });
    });
  }
  function tabBtn(key, label){
    return '<button type="button" class="tab-btn' + (currentTab===key?' active':'') + '" data-tab="' + key + '">' + label + '</button>';
  }

  function renderTabBody(){
    var s = getStudent(currentStudentId);
    var body = document.getElementById('tab-body');
    if(!s || !body) return;

    if(currentTab === 'notas'){
      body.innerHTML =
        '<form id="form-add-notas" class="add-form">' +
          '<div class="field"><label>Disciplina</label><input type="text" id="nt-disc" required></div>' +
          '<div class="field" style="max-width:100px;"><label>Valor</label><input type="text" id="nt-valor" placeholder="0-10" required></div>' +
          '<div class="field"><label>Data</label><input type="date" id="nt-data" required></div>' +
          '<button class="btn btn-sm btn-primary" type="submit">Adicionar</button>' +
        '</form>' +
        listOrEmpty((s.notas||[]).slice().sort(function(a,b){return (b.data||'').localeCompare(a.data||'');}), function(n){
          var tier = gradeTier(n.valor);
          return '<div class="item-row grade-' + tier + '"><div class="info">' + escapeHtml(n.disciplina) + ' — <span class="grade-badge grade-' + tier + '">' + escapeHtml(n.valor) + '</span><div class="meta">' + formatDate(n.data) + '</div></div>' +
            '<div class="actions"><button class="icon-btn" data-edit="notas:' + n.id + '" title="Editar">✎</button><button class="icon-btn" data-del="notas:' + n.id + '">✕</button></div></div>';
        }, 'Nenhuma nota lançada ainda.');
      document.getElementById('form-add-notas').addEventListener('submit', function(ev){
        ev.preventDefault();
        var disc = document.getElementById('nt-disc').value.trim();
        var valor = document.getElementById('nt-valor').value.trim();
        var data = document.getElementById('nt-data').value;
        if(!disc || !valor || !data) return;
        if(parseGrade(valor) === null){ toastErr('Digite uma nota entre 0 e 10 (ex.: 7,5).'); return; }
        s.notas = s.notas || [];
        s.notas.push({id: uid(), disciplina: disc, valor: valor, data: data});
        saveStudents();
        renderTabBody();
      });
    }

    else if(currentTab === 'tarefas'){
      body.innerHTML =
        '<form id="form-add-tarefas" class="add-form">' +
          '<div class="field"><label>Descrição</label><input type="text" id="tf-desc" required></div>' +
          '<div class="field"><label>Prazo</label><input type="date" id="tf-prazo" required></div>' +
          '<button class="btn btn-sm btn-primary" type="submit">Adicionar</button>' +
        '</form>' +
        listOrEmpty((s.tarefas||[]).slice().sort(function(a,b){return (a.prazo||'').localeCompare(b.prazo||'');}), function(t){
          return '<div class="item-row"><div class="info">' + escapeHtml(t.descricao) +
            ' <span class="badge ' + (t.concluida?'done':'pending') + '">' + (t.concluida?'entregue':'pendente') + '</span>' +
            '<div class="meta">Prazo: ' + formatDate(t.prazo) + '</div></div>' +
            '<div class="actions">' +
              '<button class="icon-btn" data-edit="tarefas:' + t.id + '" title="Editar">✎</button><button class="icon-btn" data-toggle="tarefas:' + t.id + '" title="Marcar entregue">' + (t.concluida?'↺':'✓') + '</button>' +
              '<button class="icon-btn" data-del="tarefas:' + t.id + '">✕</button>' +
            '</div></div>';
        }, 'Nenhuma tarefa cadastrada ainda.');
      document.getElementById('form-add-tarefas').addEventListener('submit', function(ev){
        ev.preventDefault();
        var desc = document.getElementById('tf-desc').value.trim();
        var prazo = document.getElementById('tf-prazo').value;
        if(!desc || !prazo) return;
        s.tarefas = s.tarefas || [];
        s.tarefas.push({id: uid(), descricao: desc, prazo: prazo, concluida: false});
        saveStudents();
        renderTabBody();
      });
    }

    else if(currentTab === 'frequencia'){
      var resumo = attendanceSummary(s);
      body.innerHTML =
        '<div class="panel-box" style="margin-bottom:1rem; padding:0.9rem 1rem;">' +
          '<strong>' + (resumo.rate === null ? 'Sem registros de frequência' : resumo.rate + '% de presença') + '</strong>' +
          '<div class="meta" style="margin-top:0.25rem;">' + resumo.present + ' presenças · ' + resumo.absent + ' faltas em ' + resumo.total + ' registros</div>' +
        '</div>' +
        '<form id="form-add-frequencia" class="add-form">' +
          '<div class="field"><label>Data</label><input type="date" id="fr-data" required></div>' +
          '<div class="field"><label>Registro</label><select id="fr-status" required><option value="presente">Presente</option><option value="falta">Falta</option></select></div>' +
          '<div class="field"><label>Observação (opcional)</label><input type="text" id="fr-nota" placeholder="Ex.: aula de Matemática"></div>' +
          '<button class="btn btn-sm btn-primary" type="submit">Registrar</button>' +
        '</form>' +
        listOrEmpty((s.frequencia||[]).slice().sort(function(a,b){return (b.data||'').localeCompare(a.data||'');}), function(f){
          var presente = f.status === 'presente';
          return '<div class="item-row"><div class="info"><span class="badge ' + (presente ? 'present' : 'absent') + '">' + (presente ? 'presente' : 'falta') + '</span>' +
            (f.nota ? ' ' + escapeHtml(f.nota) : '') + '<div class="meta">' + formatDate(f.data) + '</div></div>' +
            '<div class="actions"><button class="icon-btn" data-del="frequencia:' + f.id + '" title="Excluir registro">✕</button></div></div>';
        }, 'Nenhum registro de frequência ainda.');
      document.getElementById('form-add-frequencia').addEventListener('submit', function(ev){
        ev.preventDefault();
        var data = document.getElementById('fr-data').value;
        var status = document.getElementById('fr-status').value;
        var nota = document.getElementById('fr-nota').value.trim();
        if(!data || !status) return;
        s.frequencia = s.frequencia || [];
        s.frequencia.push({id: uid(), data: data, status: status, nota: nota});
        saveStudents();
        renderTabBody();
      });
    }

    else if(currentTab === 'observacoes'){
      body.innerHTML =
        '<form id="form-add-obs" class="add-form">' +
          '<div class="field" style="flex:2;"><label>Observação</label><textarea id="ob-texto" required></textarea></div>' +
          '<div class="field"><label>Data</label><input type="date" id="ob-data" required></div>' +
          '<button class="btn btn-sm btn-primary" type="submit">Adicionar</button>' +
        '</form>' +
        listOrEmpty((s.observacoes||[]).slice().sort(function(a,b){return (b.data||'').localeCompare(a.data||'');}), function(o){
          return '<div class="item-row"><div class="info">' + escapeHtml(o.texto) + '<div class="meta">' + formatDate(o.data) + '</div></div>' +
            '<div class="actions"><button class="icon-btn" data-edit="observacoes:' + o.id + '" title="Editar">✎</button><button class="icon-btn" data-del="observacoes:' + o.id + '">✕</button></div></div>';
        }, 'Nenhuma observação registrada ainda.');
      document.getElementById('form-add-obs').addEventListener('submit', function(ev){
        ev.preventDefault();
        var texto = document.getElementById('ob-texto').value.trim();
        var data = document.getElementById('ob-data').value;
        if(!texto || !data) return;
        s.observacoes = s.observacoes || [];
        s.observacoes.push({id: uid(), texto: texto, data: data});
        saveStudents();
        renderTabBody();
      });
    }

    else if(currentTab === 'plano'){
      body.innerHTML =
        '<div class="plano-box">' +
          '<div class="field"><label>Plano de melhoria</label><textarea id="plano-texto">' + escapeHtml(s.plano||'') + '</textarea></div>' +
          '<button class="btn btn-sm btn-primary" id="btn-save-plano">Salvar plano</button>' +
        '</div>';
      document.getElementById('btn-save-plano').addEventListener('click', function(){
        s.plano = document.getElementById('plano-texto').value; this.textContent = 'Salvo ✓';
        saveStudents();
      });
    }

    var EDIT_FIELDS = {notas:[['disciplina','Disciplina'],['valor','Nota (0 a 10)']], tarefas:[['descricao','Descrição da tarefa']], observacoes:[['texto','Observação']]};
    body.querySelectorAll('[data-edit]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var parts = btn.getAttribute('data-edit').split(':');
        var item = (s[parts[0]]||[]).find(function(x){ return x.id === parts[1]; });
        if(!item) return;
        var fields = EDIT_FIELDS[parts[0]];
        var html = fields.map(function(f){ return '<div class="field"><label>' + f[1] + '</label><input type="text" data-f="' + f[0] + '" value="' + escapeHtml(item[f[0]] || '') + '"></div>'; }).join('');
        dialog({title: 'Editar registro', html: html, ok: 'Salvar', collect: function(bx){
          var out = {}, valid = true;
          bx.querySelectorAll('[data-f]').forEach(function(inp){
            var key = inp.getAttribute('data-f'), v = inp.value.trim();
            if(!v || (key === 'valor' && parseGrade(v) === null)) valid = false;
            out[key] = v;
          });
          if(!valid){ toast('Preencha os campos (a nota vai de 0 a 10).', 'err'); return undefined; }
          return out;
        }}).then(function(v){
          if(!v) return;
          Object.keys(v).forEach(function(key){ item[key] = v[key]; });
          saveStudents(); renderTabBody(); toast('Registro atualizado.');
        });
      });
    });
    // delegate delete/toggle
    body.querySelectorAll('[data-del]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var parts = btn.getAttribute('data-del').split(':');
        confirmBox('Excluir este registro?', {title: 'Excluir registro', ok: 'Excluir', danger: true}).then(function(ok){
          if(!ok) return;
          s[parts[0]] = (s[parts[0]]||[]).filter(function(x){ return x.id !== parts[1]; });
          saveStudents();
          renderTabBody();
        });
      });
    });
    body.querySelectorAll('[data-toggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var parts = btn.getAttribute('data-toggle').split(':');
        var arr = s[parts[0]] || [];
        var item = arr.find(function(x){ return x.id === parts[1]; });
        if(item) item.concluida = !item.concluida;
        saveStudents();
        renderTabBody();
      });
    });
  }

  function listOrEmpty(arr, fn, emptyMsg){
    if(!arr.length) return '<p class="empty">' + emptyMsg + '</p>';
    return arr.map(fn).join('');
  }

  // ---------- NEW / EDIT STUDENT FORM ----------
  function openStudentForm(existing){
    var overlay = document.getElementById('overlay');
    overlay.className = 'overlay center';
    overlay.innerHTML =
      '<div class="modal modal-form">' +
        '<div style="padding:1.6rem;">' +
        '<button class="modal-close" id="modal-close2">×</button>' +
        '<h3 style="margin-bottom:1rem;">' + (existing ? 'Editar aluno' : 'Novo aluno') + '</h3>' +
        '<form id="form-student">' +
          '<div class="field"><label>Nome completo</label><input type="text" id="st-nome" value="' + (existing?escapeHtml(existing.nome):'') + '" required></div>' +
          '<div class="field"><label>Turma</label><select id="st-turma" required>' + turmaSelectOptions(existing?existing.turma:'') + '</select></div>' +
          '<div class="field"><label>Cor do avatar (opcional)</label>' + swatchesHtml(existing && existing.cor || '') + '</div>' +
          '<button class="btn btn-primary" type="submit">' + (existing ? 'Salvar alterações' : 'Cadastrar aluno') + '</button>' +
        '</form>' +
        '</div>' +
      '</div>';
    wireSwatches(document.getElementById('form-student'));
    document.getElementById('modal-close2').addEventListener('click', function(){
      if(existing){ closeModal(); openStudentDetail(existing.id); }
      else { closeModal(); }
    });
    document.getElementById('form-student').addEventListener('submit', function(ev){
      ev.preventDefault();
      var nome = document.getElementById('st-nome').value.trim();
      var turma = document.getElementById('st-turma').value.trim();
      if(!nome) return;
      if(existing){
        existing.nome = nome;
        existing.turma = turma;
        existing.cor = pickedColor(document.getElementById('form-student'), existing.cor);
        saveStudents();
        closeModal();
        openStudentDetail(existing.id);
      } else {
        var novo = {id: uid(), nome: nome, turma: turma, notas: [], tarefas: [], observacoes: [], plano: '', cor: pickedColor(document.getElementById('form-student'), undefined)};
        state.students.push(novo);
        saveStudents();
        closeModal();
        render();
      }
    });
  }

  // ---------- VIEW-LEVEL HANDLERS ----------
  function attachViewHandlers(){
    var main = document.getElementById('main');

    var bExp = document.getElementById('btn-export');
    if(bExp){
      bExp.addEventListener('click', function(){
        download('edunote-backup-' + today() + '.json', JSON.stringify({versao:1, students:state.students, events:state.events, settings:state.settings}, null, 2), 'application/json');
      });
      var fileIn = document.getElementById('file-import');
      document.getElementById('btn-import').addEventListener('click', function(){ fileIn.click(); });
      fileIn.addEventListener('change', function(){
        var file = fileIn.files[0]; if(!file) return;
        var r = new FileReader();
        r.onload = async function(){
          try{
            var d = JSON.parse(r.result);
            if(!Array.isArray(d.students) || !Array.isArray(d.events)) throw new Error('formato');
            if(!(await confirmBox('Importar ' + d.students.length + ' aluno(s) e ' + d.events.length + ' evento(s)? Os dados atuais serão substituídos.', {title: 'Importar backup', ok: 'Importar', danger: true}))) return;
            state.students = d.students; state.events = d.events;
            state.settings = d.settings || state.settings;
            applyTheme(state.settings.theme || 'manila');
            saveStudents(); saveEvents(); saveSettings(); render();
          } catch(err){ toastErr('Arquivo inválido. Use um backup exportado pelo EduNote.'); }
        };
        r.readAsText(file);
      });
      document.getElementById('btn-csv').addEventListener('click', function(){
        var q = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
        var lines = [['Nome','Turma','Média','Presença (%)','Faltas','Tarefas pendentes'].map(q).join(';')];
        state.students.slice().sort(function(a,b){ return a.nome.localeCompare(b.nome, 'pt-BR'); }).forEach(function(s){
          var m = studentAverage(s), f = attendanceSummary(s);
          lines.push([s.nome, turmaLabel(s.turma), m === null ? '' : m.toFixed(1).replace('.', ','), f.rate === null ? '' : f.rate, f.absent,
            (s.tarefas||[]).filter(function(t){ return !t.concluida; }).length].map(q).join(';'));
        });
        download('alunos-' + today() + '.csv', '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8');
      });
      document.getElementById('btn-wipe').addEventListener('click', async function(){
        if(!(await confirmBox('Apagar TODOS os alunos, eventos e grupos da sua conta? Isso não pode ser desfeito.', {title: 'Apagar todos os dados', ok: 'Continuar', danger: true}))) return;
        if(!(await confirmBox('Tem certeza? Exporte um backup antes, se ainda não fez.', {title: 'Última confirmação', ok: 'Apagar tudo', danger: true}))) return;
        state.students = []; state.events = []; state.settings.grupos = [];
        saveStudents(); saveEvents(); saveSettings(); render(); toast('Dados apagados.');
      });
    }
    main.querySelectorAll('[data-edit-event]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var e = state.events.find(function(x){ return x.id === btn.getAttribute('data-edit-event'); });
        if(!e) return;
        dialog({title: 'Editar evento', ok: 'Salvar',
          html: '<div class="field"><label>Título</label><input type="text" data-f="titulo" value="' + escapeHtml(e.titulo) + '"></div>' +
                '<div class="field"><label>Data</label><input type="date" data-f="data" value="' + escapeHtml(e.data || '') + '"></div>' +
                '<div class="field"><label>Categoria</label><select data-f="categoria">' + catOptions(e.categoria || 'outro') + '</select></div>',
          collect: function(bx){
            var t = fieldVal(bx, 'titulo').value.trim(), d = fieldVal(bx, 'data').value;
            if(!t || !d){ toast('Informe o título e a data.', 'err'); return undefined; }
            return {t: t, d: d, c: fieldVal(bx, 'categoria').value};
          }}).then(function(v){
          if(!v) return;
          e.titulo = v.t; e.data = v.d; e.categoria = v.c; saveEvents(); render(); toast('Evento atualizado.');
        });
      });
    });

    var sOrd = document.getElementById('al-ordem');
    if(sOrd) sOrd.addEventListener('change', function(){ state.settings.alunosOrdem = sOrd.value; saveSettings(); render(); });
    var sVis = document.getElementById('al-visao');
    if(sVis) sVis.addEventListener('change', function(){ state.settings.alunosVisao = sVis.value; saveSettings(); render(); });
    main.querySelectorAll('[data-ecat]').forEach(function(b){ b.addEventListener('click', function(){ eventCat = b.getAttribute('data-ecat'); render(); }); });
    var evWhen = document.getElementById('ev-when');
    if(evWhen) evWhen.addEventListener('change', function(){ eventWhen = evWhen.value; render(); });

    var bNewG = document.getElementById('btn-new-group');
    if(bNewG){
      bNewG.addEventListener('click', function(){ openGroupForm(null); });
      document.getElementById('btn-draw-groups').addEventListener('click', openDrawForm);
      var bClr = document.getElementById('btn-clear-groups');
      if(bClr) bClr.addEventListener('click', function(){
        confirmBox('Apagar todos os grupos?', {title: 'Limpar grupos', ok: 'Apagar', danger: true}).then(function(ok){
          if(!ok) return; state.settings.grupos = []; saveSettings(); render(); toast('Grupos apagados.');
        });
      });
    }
    main.querySelectorAll('[data-gedit]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var g = groupsList().find(function(x){ return x.id === btn.getAttribute('data-gedit'); }); if(g) openGroupForm(g);
      });
    });
    main.querySelectorAll('[data-gdel]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-gdel');
        confirmBox('Excluir este grupo? Os alunos não são apagados.', {title: 'Excluir grupo', ok: 'Excluir', danger: true}).then(function(ok){
          if(!ok) return; state.settings.grupos = groupsList().filter(function(x){ return x.id !== id; }); saveSettings(); render();
        });
      });
    });

    var btnNew = document.getElementById('btn-new-student');
    if(btnNew) btnNew.addEventListener('click', function(){ openStudentForm(null); document.getElementById('overlay').classList.remove('hidden'); });

    var search = document.getElementById('student-search');
    if(search){
      search.addEventListener('input', function(){
        studentSearch = search.value;
        var focusPos = search.selectionStart;
        render();
        var s2 = document.getElementById('student-search');
        if(s2){ s2.focus(); s2.setSelectionRange(focusPos, focusPos); }
      });
    }
    var turmaFilterSelect = document.getElementById('turma-filter');
    if(turmaFilterSelect){
      turmaFilterSelect.addEventListener('change', function(){
        turmaFilter = turmaFilterSelect.value;
        render();
      });
    }

    main.querySelectorAll('[data-theme-choice]').forEach(function(card){
      card.addEventListener('click', function(){
        state.settings.theme = card.getAttribute('data-theme-choice');
        applyTheme(state.settings.theme);
        saveSettings();
        render();
      });
    });

    main.querySelectorAll('.student-card').forEach(function(card){
      card.addEventListener('click', function(){
        openStudentDetail(card.getAttribute('data-id'));
        document.getElementById('overlay').classList.remove('hidden');
      });
    });

    var evForm = document.getElementById('form-new-event');
    if(evForm){
      evForm.addEventListener('submit', function(ev){
        ev.preventDefault();
        var titulo = document.getElementById('ev-titulo').value.trim();
        var data = document.getElementById('ev-data').value;
        var turma = document.getElementById('ev-turma').value.trim();
        if(!titulo || !data) return;
        state.events.push({id: uid(), titulo: titulo, data: data, turma: turma, categoria: document.getElementById('ev-cat').value});
        saveEvents();
        render();
      });
    }
    main.querySelectorAll('[data-del-event]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-del-event');
        confirmBox('Excluir este evento?', {title: 'Excluir evento', ok: 'Excluir', danger: true}).then(function(ok){
          if(!ok) return;
          state.events = state.events.filter(function(e){ return e.id !== id; });
          saveEvents();
          render();
        });
      });
    });
  }

  document.addEventListener('keydown', function(ev){
    if(ev.key === 'Escape' && !document.getElementById('overlay').classList.contains('hidden')) closeModal();
  });
  document.getElementById('overlay').addEventListener('click', function(ev){
    if(ev.target.id === 'overlay') closeModal();
  });

  // ---------- INIT ----------
  // ---------- LOGIN ----------
  var authEl = document.getElementById('auth');
  function authMsg(t, ok){ var m = document.getElementById('auth-msg'); m.textContent = t || ''; m.className = 'auth-msg' + (ok ? ' ok' : ''); }
  function showAuth(msg){ authEl.classList.remove('hidden'); authMsg(msg); document.getElementById('au-pass').value = ''; }
  function authError(m){
    m = String(m || '');
    if(m.indexOf('Invalid login') !== -1) return 'E-mail ou senha incorretos.';
    if(m.indexOf('not confirmed') !== -1) return 'Confirme seu e-mail pelo link enviado à sua caixa de entrada e tente de novo.';
    if(m.indexOf('already registered') !== -1) return 'Este e-mail já tem conta. Clique em Entrar.';
    if(m.indexOf('rate limit') !== -1) return 'Muitas tentativas. Aguarde alguns minutos.';
    if(m.indexOf('different from the old') !== -1) return 'A nova senha precisa ser diferente da anterior.';
    if(m.indexOf('not authorized') !== -1) return 'O envio de e-mails ainda não está configurado no Supabase (SMTP).';
    return m || 'Não foi possível entrar. Tente de novo.';
  }
  async function enter(user){
    currentUser = user;
    state.loaded = false; render();
    try{
      var r = await sb.from('edunote_data').select('*').eq('user_id', user.id).maybeSingle();
      if(r.error) throw r.error;
      cloud = r.data || { students: [], events: [], settings: {} };
    } catch(err){
      currentUser = null; cloud = null;
      await sb.auth.signOut();
      showAuth('Não foi possível carregar seus dados (' + (err.message || 'erro') + '). Confira a conexão e se o script SQL foi executado.');
      return;
    }
    await loadState();
    await migrateLocal();
    authEl.classList.add('hidden');
    document.getElementById('user-box').innerHTML = '<div class="em">' + escapeHtml(user.email) + '</div><button class="btn btn-sm" id="btn-logout">Sair</button>';
    document.getElementById('btn-logout').addEventListener('click', function(){ sb.auth.signOut(); });
    render();
  }
  async function migrateLocal(){
    if(state.students.length || state.events.length) return;
    try{
      var loc = JSON.parse(localStorage.getItem('edunote:students') || '[]');
      if(!Array.isArray(loc) || !loc.length) return;
      if(!(await confirmBox('Encontramos ' + loc.length + ' aluno(s) salvos neste navegador. Enviar para a sua conta?', {title: 'Dados deste navegador', ok: 'Enviar'}))) return;
      state.students = loc;
      var ev = JSON.parse(localStorage.getItem('edunote:events') || '[]');
      if(Array.isArray(ev)) state.events = ev;
      await saveStudents(); await saveEvents();
    } catch(err){ console.error('Migração', err); }
  }
  async function doAuth(mode){
    var email = document.getElementById('au-email').value.trim();
    var pass = document.getElementById('au-pass').value;
    if(!email || pass.length < 6){ authMsg('Informe o e-mail e uma senha de pelo menos 6 caracteres.'); return; }
    if(mode === 'up' && pwStrength(pass).n < 2){ authMsg('Senha fraca demais. Use 8 ou mais caracteres, misturando letras e números.'); return; }
    var btns = authEl.querySelectorAll('button');
    btns.forEach(function(b){ b.disabled = true; }); authMsg('');
    try{
      var r = mode === 'up' ? await sb.auth.signUp({email: email, password: pass}) : await sb.auth.signInWithPassword({email: email, password: pass});
      if(r.error) authMsg(authError(r.error.message));
      else if(r.data && r.data.session) await enter(r.data.session.user);
      else authMsg('Conta criada! Abra o link enviado ao seu e-mail e depois clique em Entrar.', true);
    } catch(err){ authMsg(netError(err)); }
    btns.forEach(function(b){ b.disabled = false; });
  }
  var recovering = BOOT_HASH.indexOf('type=recovery') !== -1;
  var authMode = 'login';
  function pwStrength(p){
    if(!p) return {n: 0, label: '', tip: ''};
    if(p.length < 8) return {n: 1, label: 'Fraca', tip: 'use pelo menos 8 caracteres.'};
    var low = p.toLowerCase();
    var common = ['123456','000000','111111','senha','password','qwerty','abc123','admin','edunote','iloveyou'];
    if(/^(.)\1+$/.test(p) || (p.length < 12 && common.some(function(w){ return low.indexOf(w) !== -1; })))
      return {n: 1, label: 'Fraca', tip: 'evite sequências e palavras comuns.'};
    var kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function(r){ return r.test(p); }).length;
    var pts = (p.length >= 10 ? 1 : 0) + (p.length >= 14 ? 1 : 0) + (kinds >= 2 ? 1 : 0) + (kinds >= 3 ? 1 : 0) + (kinds === 4 ? 1 : 0);
    var n = pts === 0 ? 1 : pts <= 2 ? 2 : pts <= 4 ? 3 : 4;
    var tip = n >= 3 ? '' : (kinds < 3 ? 'misture maiúsculas, minúsculas, números e símbolos.' : 'use 12 ou mais caracteres.');
    return {n: n, label: ['', 'Fraca', 'Média', 'Forte', 'Muito forte'][n], tip: tip};
  }
  function updateMeter(){
    var p = document.getElementById('au-pass').value, r = pwStrength(p), f = document.getElementById('pw-fill');
    f.style.width = (r.n * 25) + '%'; f.className = 'lv' + r.n;
    document.getElementById('pw-label').textContent = p ? 'Senha ' + r.label.toLowerCase() + (r.tip ? ' — ' + r.tip : '') : 'Use 8 ou mais caracteres, com letras e números.';
  }
  function setMode(m){
    authMode = m;
    document.getElementById('auth-form').setAttribute('data-mode', m);
    document.querySelectorAll('#auth-form [data-show]').forEach(function(el){
      el.hidden = el.getAttribute('data-show').split(' ').indexOf(m) === -1;
    });
    document.getElementById('au-title').textContent = {login:'Entrar', signup:'Criar conta', forgot:'Recuperar senha', recovery:'Definir nova senha'}[m];
    document.getElementById('au-submit').textContent = {login:'Entrar', signup:'Criar conta', forgot:'Enviar link por e-mail', recovery:'Salvar nova senha'}[m];
    document.getElementById('au-pass-label').textContent = m === 'recovery' ? 'Nova senha' : 'Senha';
    document.getElementById('au-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    authMsg(''); updateMeter();
  }
  function setBusy(on){ authEl.querySelectorAll('button').forEach(function(b){ b.disabled = on; }); }
  function netError(err){
    console.error(err);
    var m = String(err && err.message || err || '');
    if(/fetch|network|load failed/i.test(m)) return 'Sem conexão com o servidor. Confira a internet, desative bloqueadores de anúncio e veja se o projeto do Supabase não está pausado.';
    return 'Erro ao entrar: ' + m;
  }
  async function doForgot(){
    var email = document.getElementById('au-email').value.trim();
    if(!email){ authMsg('Informe o e-mail da conta.'); return; }
    if(location.protocol === 'file:'){ authMsg('Para recuperar a senha, abra o site pelo Live Server ou pela hospedagem, não direto pelo arquivo.'); return; }
    setBusy(true); authMsg('');
    try{
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if(r.error) authMsg(authError(r.error.message));
      else authMsg('Se este e-mail tiver conta, enviamos um link para criar uma nova senha. Confira também o spam.', true);
    } catch(err){ authMsg(netError(err)); }
    setBusy(false);
  }
  async function doRecovery(){
    var pass = document.getElementById('au-pass').value;
    if(pwStrength(pass).n < 2){ authMsg('Senha fraca demais. Use 8 ou mais caracteres, misturando letras e números.'); return; }
    setBusy(true); authMsg('');
    try{
      var r = await sb.auth.updateUser({ password: pass });
      if(r.error) authMsg(authError(r.error.message));
      else { recovering = false; history.replaceState(null, '', location.pathname + location.search); setBusy(false); await enter(r.data.user); return; }
    } catch(err){ authMsg(netError(err)); }
    setBusy(false);
  }
  document.getElementById('auth-form').addEventListener('submit', function(ev){
    ev.preventDefault();
    if(authMode === 'signup') doAuth('up');
    else if(authMode === 'forgot') doForgot();
    else if(authMode === 'recovery') doRecovery();
    else doAuth('in');
  });
  document.getElementById('au-pass').addEventListener('input', updateMeter);
  document.getElementById('au-to-signup').addEventListener('click', function(){ setMode('signup'); });
  document.getElementById('au-to-forgot').addEventListener('click', function(){ setMode('forgot'); });
  document.getElementById('au-to-login').addEventListener('click', function(){ setMode('login'); });
  sb.auth.onAuthStateChange(function(ev){
    if(ev === 'PASSWORD_RECOVERY'){ recovering = true; setMode('recovery'); showAuth(''); return; }
    if(ev === 'SIGNED_OUT' && currentUser){
      currentUser = null; cloud = null;
      state.students = []; state.events = []; state.loaded = false;
      closeModal(); document.getElementById('user-box').innerHTML = '';
      render(); setMode('login'); showAuth('Você saiu. Entre novamente para continuar.');
    }
  });

  render();
  setMode('login');
  sb.auth.getSession().then(function(r){
    if(BOOT_HASH.indexOf('error=') !== -1 || BOOT_HASH.indexOf('error_code=') !== -1){
      history.replaceState(null, '', location.pathname + location.search);
      setMode('forgot'); showAuth('O link expirou ou já foi usado. Peça um novo abaixo.');
    } else if(recovering){ setMode('recovery'); showAuth(''); }
    else if(r.data && r.data.session) enter(r.data.session.user); else showAuth('');
  }).catch(function(){ showAuth('Falha de conexão. Recarregue a página.'); });

})();
