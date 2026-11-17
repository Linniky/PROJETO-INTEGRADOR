(function(){
  "use strict";
  var BOOT_HASH = location.hash; // guarda o #... do link de recuperação antes de o Supabase limpar

  var state = { students: [], events: [], settings: { theme: 'manila' }, loaded: false };
  var currentView = "dashboard";
  var currentStudentId = null;
  var currentTab = "notas";
  var studentSearch = "";
  var turmaFilter = "";

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
    alert('Não foi possível salvar na nuvem. Verifique a conexão e tente de novo. Se persistir, exporte um backup em Configurações.');
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
    if(!w){ alert('Libere pop-ups para imprimir o boletim.'); return; }
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

    return '' +
    '<div class="view-head"><div><p class="eyebrow">Painel</p><h2>Visão geral</h2></div></div>' +
    '<div class="stat-grid">' +
      statCard('Alunos', totalAlunos, 'Cadastrados') +
      statCard('Tarefas', totalTarefasPendentes, 'Pendentes') +
      statCard('Notas', totalNotas, 'Lançadas') +
      statCard('Frequência', taxaFrequencia, totalFaltas + ' faltas · ' + totalRegistrosFrequencia + ' registros') +
      statCard('Observações', totalObs, 'Registradas') +
    '</div>' +
    '<div class="panel-cols">' +
      '<div class="panel-box"><h3>Próximos eventos</h3>' +
        (proximosEventos.length ? proximosEventos.map(function(e){
          return '<div class="row-line"><span>' + escapeHtml(e.titulo) + (e.turma ? ' <span class="meta">· ' + escapeHtml(e.turma) + '</span>' : '') + '</span><span class="meta">' + formatDate(e.data) + '</span></div>';
        }).join('') : '<p class="empty">Nenhum evento futuro cadastrado.</p>') +
      '</div>' +
      '<div class="panel-box"><h3>Tarefas pendentes</h3>' +
        (pendentesList.length ? pendentesList.map(function(t){
          return '<div class="row-line"><span>' + escapeHtml(t.descricao) + ' <span class="meta">· ' + escapeHtml(t.aluno) + '</span></span><span class="meta">' + formatDate(t.prazo) + '</span></div>';
        }).join('') : '<p class="empty">Nenhuma tarefa pendente. 🎉</p>') +
      '</div>' +
      '<div class="panel-box" style="grid-column:1/-1;"><h3>Alunos em atenção</h3>' +
        (attentionList().length ? attentionList().map(function(a){
          return '<div class="row-line warn-row"><span>' + escapeHtml(a.nome) + ' <span class="meta">· ' + escapeHtml(turmaLabel(a.turma)) + '</span></span><span class="meta">' + a.why + '</span></div>';
        }).join('') : '<p class="empty">Nenhum aluno com média abaixo de 5 ou presença abaixo de 75%.</p>') +
      '</div>' +
    '</div>';
  }
  function statCard(tab, num, label){
    return '<div class="stat-card"><span class="tab">' + escapeHtml(tab) + '</span><div class="num">' + num + '</div><div class="label">' + escapeHtml(label) + '</div></div>';
  }

  // ---------- STUDENTS LIST ----------
  function renderStudents(){
    var q = studentSearch.toLowerCase();
    var list = state.students.filter(function(s){
      var matchesSearch = !q || s.nome.toLowerCase().indexOf(q) !== -1 || turmaLabel(s.turma).toLowerCase().indexOf(q) !== -1;
      var matchesTurma = !turmaFilter || s.turma === turmaFilter;
      return matchesSearch && matchesTurma;
    });
    list.sort(function(a,b){ return a.nome.localeCompare(b.nome, 'pt-BR', {sensitivity:'base'}); });

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
      body = '<div class="student-grid">' + list.map(renderStudentCard).join('') + '</div>';
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
          '<div class="student-grid">' + groups[key].map(renderStudentCard).join('') + '</div>' +
        '</div>';
      }).join('');
    }

    return '' +
    '<div class="view-head"><div><p class="eyebrow">Alunos</p><h2>Fichas dos alunos</h2></div>' +
      '<button class="btn btn-primary" id="btn-new-student">+ Novo aluno</button>' +
    '</div>' +
    '<div class="toolbar">' +
      '<input class="search-input" id="student-search" placeholder="Buscar por nome ou turma…" value="' + escapeHtml(studentSearch) + '">' +
      '<select class="search-input" id="turma-filter" style="flex:none; width:auto;">' + turmaOptions + '</select>' +
    '</div>' +
    body;
  }

  function renderStudentCard(s){
    var pendentes = (s.tarefas||[]).filter(function(t){ return !t.concluida; }).length;
    var media = studentAverage(s);
    var frequencia = attendanceSummary(s);
    var mediaTier = media === null ? 'na' : gradeTier(media);
    return '<div class="student-card" data-id="' + s.id + '">' +
      '<div style="display:flex; justify-content:space-between; align-items:flex-start;">' +
        '<h4>' + escapeHtml(s.nome) + '</h4>' +
        '<span class="grade-badge grade-' + mediaTier + '">' + (media === null ? '—' : media.toFixed(1)) + '</span>' +
      '</div>' +
      '<span class="turma">' + escapeHtml(turmaLabel(s.turma)) + '</span>' +
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
    var sorted = state.events.slice().sort(function(a,b){ return (a.data||'').localeCompare(b.data||''); });
    return '' +
    '<div class="view-head"><div><p class="eyebrow">Calendário</p><h2>Eventos</h2></div></div>' +
    '<div class="panel-box" style="margin-bottom:1.4rem;">' +
      '<h3>Novo evento</h3>' +
      '<form id="form-new-event" class="add-form">' +
        '<div class="field"><label>Título</label><input type="text" id="ev-titulo" required></div>' +
        '<div class="field"><label>Data</label><input type="date" id="ev-data" required></div>' +
        '<div class="field"><label>Turma (opcional)</label><select id="ev-turma">' + turmaSelectOptions('') + '</select></div>' +
        '<button class="btn btn-primary btn-sm" type="submit">Adicionar</button>' +
      '</form>' +
    '</div>' +
    (sorted.length ? sorted.map(function(e){
      return '<div class="item-row"><div class="info">' + escapeHtml(e.titulo) +
        (e.turma ? ' <span class="meta">· ' + escapeHtml(e.turma) + '</span>' : '') +
        '<div class="meta">' + formatDate(e.data) + '</div></div>' +
        '<div class="actions"><button class="icon-btn" data-edit-event="' + e.id + '" title="Editar">✎</button><button class="icon-btn" data-del-event="' + e.id + '" title="Excluir">✕</button></div></div>';
    }).join('') : '<p class="empty">Nenhum evento cadastrado ainda.</p>');
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
      if(confirm('Excluir ' + s.nome + ' e todos os seus registros?')){
        state.students = state.students.filter(function(x){ return x.id !== s.id; });
        saveStudents();
        closeModal();
        render();
      }
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
        if(parseGrade(valor) === null){ alert('Digite uma nota entre 0 e 10 (ex.: 7,5).'); return; }
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
        var novo = {};
        for(var i = 0; i < EDIT_FIELDS[parts[0]].length; i++){
          var f = EDIT_FIELDS[parts[0]][i];
          var v = prompt(f[1] + ':', item[f[0]]);
          if(v === null) return;
          v = v.trim();
          if(!v) return;
          if(f[0] === 'valor' && parseGrade(v) === null){ alert('Digite uma nota entre 0 e 10.'); return; }
          novo[f[0]] = v;
        }
        Object.keys(novo).forEach(function(k){ item[k] = novo[k]; });
        saveStudents();
        renderTabBody();
      });
    });
    // delegate delete/toggle
    body.querySelectorAll('[data-del]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var parts = btn.getAttribute('data-del').split(':');
        s[parts[0]] = (s[parts[0]]||[]).filter(function(x){ return x.id !== parts[1]; });
        saveStudents();
        renderTabBody();
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
          '<button class="btn btn-primary" type="submit">' + (existing ? 'Salvar alterações' : 'Cadastrar aluno') + '</button>' +
        '</form>' +
        '</div>' +
      '</div>';
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
        saveStudents();
        closeModal();
        openStudentDetail(existing.id);
      } else {
        var novo = {id: uid(), nome: nome, turma: turma, notas: [], tarefas: [], observacoes: [], plano: ''};
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
        r.onload = function(){
          try{
            var d = JSON.parse(r.result);
            if(!Array.isArray(d.students) || !Array.isArray(d.events)) throw new Error('formato');
            if(!confirm('Importar ' + d.students.length + ' aluno(s) e ' + d.events.length + ' evento(s)? Os dados atuais serão substituídos.')) return;
            state.students = d.students; state.events = d.events;
            state.settings = d.settings || state.settings;
            applyTheme(state.settings.theme || 'manila');
            saveStudents(); saveEvents(); saveSettings(); render();
          } catch(err){ alert('Arquivo inválido. Use um backup exportado pelo EduNote.'); }
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
      document.getElementById('btn-wipe').addEventListener('click', function(){
        if(!confirm('Apagar TODOS os alunos e eventos da sua conta? Isso não pode ser desfeito.')) return;
        if(!confirm('Tem certeza? Exporte um backup antes se ainda não fez.')) return;
        state.students = []; state.events = [];
        saveStudents(); saveEvents(); render();
      });
    }
    main.querySelectorAll('[data-edit-event]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var e = state.events.find(function(x){ return x.id === btn.getAttribute('data-edit-event'); });
        if(!e) return;
        var t = prompt('Título do evento:', e.titulo); if(t === null) return;
        var d = prompt('Data (dd/mm/aaaa):', formatDate(e.data)); if(d === null) return;
        var m = d.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if(t.trim()) e.titulo = t.trim();
        if(m) e.data = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
        else if(d.trim() !== formatDate(e.data)) alert('Data não alterada: use o formato dd/mm/aaaa.');
        saveEvents(); render();
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
        state.events.push({id: uid(), titulo: titulo, data: data, turma: turma});
        saveEvents();
        render();
      });
    }
    main.querySelectorAll('[data-del-event]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = btn.getAttribute('data-del-event');
        state.events = state.events.filter(function(e){ return e.id !== id; });
        saveEvents();
        render();
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
      if(!confirm('Encontramos ' + loc.length + ' aluno(s) salvos neste navegador. Enviar para a sua conta?')) return;
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
    } catch(err){ authMsg('Falha de conexão. Tente de novo.'); }
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
  async function doForgot(){
    var email = document.getElementById('au-email').value.trim();
    if(!email){ authMsg('Informe o e-mail da conta.'); return; }
    if(location.protocol === 'file:'){ authMsg('Para recuperar a senha, abra o site pelo Live Server ou pela hospedagem, não direto pelo arquivo.'); return; }
    setBusy(true); authMsg('');
    try{
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if(r.error) authMsg(authError(r.error.message));
      else authMsg('Se este e-mail tiver conta, enviamos um link para criar uma nova senha. Confira também o spam.', true);
    } catch(err){ authMsg('Falha de conexão. Tente de novo.'); }
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
    } catch(err){ authMsg('Falha de conexão. Tente de novo.'); }
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
