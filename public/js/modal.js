import {
  columns,
  createColumn,
  createMember,
  createTask,
  firstColumnId,
  memberById,
  removeColumn,
  removeMember,
  state,
  updateColumn,
  updateMember,
} from './state.js';
import { escapeHtml, icon } from './utils.js';
import { renderMarkdown } from './markdown.js';
import { toast } from './toast.js';

const backdropEl = () => document.getElementById('modal-backdrop');
const modalEl = () => document.getElementById('modal');

let teardown = null;

function show(html, { onMount, onDismiss } = {}) {
  const backdrop = backdropEl();
  const modal = modalEl();
  modal.innerHTML = html;
  backdrop.hidden = false;
  requestAnimationFrame(() => backdrop.classList.add('open'));
  document.body.style.overflow = 'hidden';

  const close = ({ skipDismiss = false } = {}) => {
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => {
      backdrop.hidden = true;
      modal.innerHTML = '';
    }, 180);
    teardown?.();
    teardown = null;
    if (!skipDismiss) onDismiss?.();
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  const onBackdrop = (event) => {
    if (event.target === backdrop) close();
  };
  backdrop.addEventListener('click', onBackdrop);

  teardown = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.removeEventListener('click', onBackdrop);
  };

  onMount?.({ close, modal });
  return close;
}

export function closeModal() {
  const backdrop = backdropEl();
  if (backdrop.hidden) return;
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
  teardown?.();
  teardown = null;
  setTimeout(() => {
    backdrop.hidden = true;
    modalEl().innerHTML = '';
  }, 180);
}

export function openTaskModal({ defaultStatus = null, onCreated } = {}) {
  // 默认落在看板第一列（列由用户维护，不能写死状态 ID）
  const initialStatus = defaultStatus ?? firstColumnId();
  const selectedLabels = new Set();
  const labelPool = state.labels;

  show(
    `<div class="modal-head">
      <h3>新建任务</h3>
      <button class="btn btn-ghost btn-sm" data-close aria-label="关闭">${icon('close', 15)}</button>
    </div>
    <form class="modal-body" id="new-task-form" novalidate>
      <div class="field">
        <span>标题</span>
        <input type="text" name="title" maxlength="160" placeholder="一句话描述要完成的事" autocomplete="off" />
        <span class="field-error" data-error hidden style="color:var(--red);font-size:11px"></span>
      </div>
      <div class="field-row">
        <label class="field">
          <span>类型</span>
          <select name="type">
            ${state.meta.types
              .map((type) => `<option value="${type.id}">${escapeHtml(type.name)}</option>`)
              .join('')}
          </select>
        </label>
        <label class="field">
          <span>优先级</span>
          <select name="priority">
            ${state.meta.priorities
              .map(
                (priority) =>
                  `<option value="${priority.id}" ${priority.id === 'medium' ? 'selected' : ''}>${escapeHtml(
                    priority.name,
                  )}</option>`,
              )
              .join('')}
          </select>
        </label>
        <label class="field">
          <span>状态</span>
          <select name="status">
            ${state.meta.statuses
              .map(
                (status) =>
                  `<option value="${status.id}" ${
                    status.id === initialStatus ? 'selected' : ''
                  }>${escapeHtml(status.name)}</option>`,
              )
              .join('')}
          </select>
        </label>
      </div>
      <div class="field-row">
        <label class="field">
          <span>负责人</span>
          <select name="assigneeId">
            <option value="">未指派</option>
            ${state.members
              .map((member) => `<option value="${member.id}">${escapeHtml(member.name)}</option>`)
              .join('')}
          </select>
        </label>
        <label class="field">
          <span>截止日期</span>
          <input type="date" name="dueDate" />
        </label>
        <label class="field">
          <span>难易程度</span>
          <select name="difficulty">
            <option value="">未评估</option>
            ${(state.meta.difficulties ?? [])
              .map(
                (item) =>
                  `<option value="${item.id}" ${item.id === 'normal' ? 'selected' : ''}>${escapeHtml(
                    item.name,
                  )}</option>`,
              )
              .join('')}
          </select>
        </label>
      </div>
      <div class="field">
        <span>标签</span>
        <div class="label-picker" data-label-picker>
          ${labelPool
            .map(
              (label) =>
                `<button type="button" class="label-toggle" data-label="${escapeHtml(label)}">${escapeHtml(
                  label,
                )}</button>`,
            )
            .join('')}
          <label class="label-custom">
            <input type="text" maxlength="24" placeholder="+ 自定义标签" data-new-label autocomplete="off" />
          </label>
        </div>
      </div>
      <div class="field">
        <div class="field-head">
          <span>描述</span>
          <button type="button" class="link-btn" data-desc-toggle>预览</button>
        </div>
        <textarea name="description" rows="3" maxlength="5000" placeholder="支持 Markdown：**粗体**、- 列表、\`代码\`、[链接](https://example.com)"></textarea>
        <div class="md-body md-preview" data-desc-preview hidden></div>
      </div>
    </form>
    <div class="modal-foot">
      <span style="font-size:11px;color:var(--text-3)">⌘/Ctrl + Enter 快速创建</span>
      <span class="spacer"></span>
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" data-submit>创建任务</button>
    </div>`,
    {
      onMount({ close, modal }) {
        const form = modal.querySelector('#new-task-form');
        const titleInput = form.elements.title;
        titleInput.focus();

        modal.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => close()));

        const bindLabel = (btn) => {
          btn.addEventListener('click', () => {
            const label = btn.dataset.label;
            if (selectedLabels.has(label)) {
              selectedLabels.delete(label);
              btn.classList.remove('on');
            } else {
              selectedLabels.add(label);
              btn.classList.add('on');
            }
          });
        };
        modal.querySelectorAll('.label-toggle[data-label]').forEach(bindLabel);

        // 自定义标签：回车即新建并选中，最多 8 个（与服务端限制一致）
        const labelPicker = modal.querySelector('[data-label-picker]');
        const labelInput = modal.querySelector('[data-new-label]');
        const addCustomLabel = () => {
          const value = labelInput.value.trim().replace(/\s+/g, ' ').slice(0, 24);
          if (!value) return;
          labelInput.value = '';
          if (selectedLabels.has(value)) return;
          if (selectedLabels.size >= 8) {
            toast('最多 8 个标签', 'error');
            return;
          }
          selectedLabels.add(value);
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'label-toggle on';
          chip.dataset.label = value;
          chip.textContent = value;
          labelPicker.insertBefore(chip, labelInput.closest('.label-custom'));
          bindLabel(chip);
        };
        labelInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addCustomLabel();
          }
          if (event.key === 'Backspace' && !labelInput.value) {
            const last = [...labelPicker.querySelectorAll('.label-toggle.on')].pop();
            if (last) last.click();
          }
        });
        labelInput.addEventListener('blur', () => {
          if (labelInput.value.trim()) addCustomLabel();
        });

        // 描述：Markdown 预览切换
        const descToggle = modal.querySelector('[data-desc-toggle]');
        const descInput = form.elements.description;
        const descPreview = modal.querySelector('[data-desc-preview]');
        descToggle.addEventListener('click', () => {
          if (!descPreview.hidden) {
            descPreview.hidden = true;
            descInput.hidden = false;
            descToggle.textContent = '预览';
            return;
          }
          descPreview.innerHTML =
            renderMarkdown(descInput.value) || '<p style="color:var(--text-3)">还没有描述内容</p>';
          descPreview.hidden = false;
          descInput.hidden = true;
          descToggle.textContent = '编辑';
        });

        const submit = async () => {
          const errorEl = form.querySelector('[data-error]');
          const title = titleInput.value.trim();
          if (!title) {
            errorEl.hidden = false;
            errorEl.textContent = '请填写任务标题';
            titleInput.focus();
            return;
          }
          errorEl.hidden = true;
          const submitBtn = modal.querySelector('[data-submit]');
          submitBtn.disabled = true;
          submitBtn.textContent = '创建中…';

          try {
            const task = await createTask({
              title,
              type: form.elements.type.value,
              priority: form.elements.priority.value,
              status: form.elements.status.value,
              assigneeId: form.elements.assigneeId.value || null,
              dueDate: form.elements.dueDate.value || null,
              difficulty: form.elements.difficulty.value || null,
              labels: [...selectedLabels],
              description: form.elements.description.value,
            });
            toast(`已创建 ${task.key}`, 'success', 2200);
            close({ skipDismiss: true });
            onCreated?.(task);
          } catch (error) {
            submitBtn.disabled = false;
            submitBtn.textContent = '创建任务';
            toast(error.message, 'error');
          }
        };

        modal.querySelector('[data-submit]').addEventListener('click', submit);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          submit();
        });
        modal.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        });
      },
    },
  );
}

export function confirmDialog({ title, message, confirmText = '确认', danger = false }) {  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    show(
      `<div class="modal-head"><h3>${escapeHtml(title)}</h3></div>
      <div class="modal-body"><p style="font-size:12.8px;color:var(--text-2);line-height:1.65">${escapeHtml(
        message,
      )}</p></div>
      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="btn" data-cancel>取消</button>
        <button class="btn ${danger ? 'btn-primary' : 'btn-primary'}" data-confirm style="${
          danger ? 'background:#e5484d;border-color:#e5484d' : ''
        }">${escapeHtml(confirmText)}</button>
      </div>`,
      {
        onDismiss() {
          finish(false);
        },
        onMount({ close, modal }) {
          modal.querySelector('[data-cancel]').addEventListener('click', () => {
            finish(false);
            close();
          });
          modal.querySelector('[data-confirm]').addEventListener('click', () => {
            finish(true);
            close();
          });
        },
      },
    );
  });
}

const FALLBACK_COLORS = [
  '#5b5bd6',
  '#2563eb',
  '#0d9488',
  '#12866f',
  '#d97706',
  '#e5484d',
  '#c026d3',
  '#7c3aed',
  '#0891b2',
  '#475569',
];

function memberColors() {
  return state.meta.memberColors?.length ? state.meta.memberColors : FALLBACK_COLORS;
}

function nextMemberColor() {
  const used = new Set(state.members.map((member) => member.color));
  return memberColors().find((color) => !used.has(color)) ?? memberColors()[0];
}

/** 新增 / 编辑成员 */
export function openMemberModal({ member = null, onSaved } = {}) {
  const isEdit = Boolean(member);
  let color = member?.color ?? nextMemberColor();

  show(
    `<div class="modal-head">
      <h3>${isEdit ? '编辑成员' : '新增成员'}</h3>
      <button class="btn btn-ghost btn-sm" data-close aria-label="关闭">${icon('close', 15)}</button>
    </div>
    <form class="modal-body" id="member-form" novalidate>
      <div class="member-form-preview">
        <span class="avatar avatar-lg" data-preview-avatar style="background:${color}">${
          member ? Array.from(member.name)[0] ?? '?' : '新'
        }</span>
        <div>
          <strong data-preview-name>${escapeHtml(member?.name ?? '新成员')}</strong>
          <span data-preview-role>${escapeHtml(member?.role ?? '团队成员')}</span>
        </div>
      </div>
      <div class="field">
        <span>姓名</span>
        <input type="text" name="name" maxlength="16" autocomplete="off" placeholder="成员姓名" value="${escapeHtml(
          member?.name ?? '',
        )}" />
        <span class="field-error" data-error hidden></span>
      </div>
      <div class="field-row two">
        <label class="field">
          <span>角色</span>
          <input type="text" name="role" maxlength="24" autocomplete="off" placeholder="如：前端工程师" value="${escapeHtml(
            member?.role ?? '',
          )}" />
        </label>
        <label class="field">
          <span>邮箱</span>
          <input type="email" name="email" maxlength="80" autocomplete="off" placeholder="可选" value="${escapeHtml(
            member?.email ?? '',
          )}" />
        </label>
      </div>
      <div class="field">
        <span>头像颜色</span>
        <div class="color-picker">
          ${memberColors()
            .map(
              (item) =>
                `<button type="button" class="color-dot ${
                  item === color ? 'on' : ''
                }" data-color="${item}" style="background:${item}" aria-label="选择颜色 ${item}"></button>`,
            )
            .join('')}
        </div>
      </div>
    </form>
    <div class="modal-foot">
      <span style="font-size:11px;color:var(--text-3)">姓名必填，同名成员会被拒绝</span>
      <span class="spacer"></span>
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" data-submit>${isEdit ? '保存' : '添加成员'}</button>
    </div>`,
    {
      onMount({ close, modal }) {
        const form = modal.querySelector('#member-form');
        const nameInput = form.elements.name;
        const errorEl = form.querySelector('[data-error]');
        const avatarEl = form.querySelector('[data-preview-avatar]');
        const previewName = form.querySelector('[data-preview-name]');
        const previewRole = form.querySelector('[data-preview-role]');
        nameInput.focus();
        nameInput.select();

        const syncPreview = () => {
          const name = nameInput.value.trim();
          avatarEl.textContent = name ? Array.from(name)[0] : '新';
          previewName.textContent = name || '新成员';
          previewRole.textContent = form.elements.role.value.trim() || '团队成员';
        };
        nameInput.addEventListener('input', syncPreview);
        form.elements.role.addEventListener('input', syncPreview);

        modal.querySelectorAll('[data-color]').forEach((dot) => {
          dot.addEventListener('click', () => {
            color = dot.dataset.color;
            avatarEl.style.background = color;
            modal.querySelectorAll('[data-color]').forEach((item) => {
              item.classList.toggle('on', item === dot);
            });
          });
        });

        modal.querySelectorAll('[data-close]').forEach((btn) => {
          btn.addEventListener('click', () => close());
        });

        const submit = async () => {
          const name = nameInput.value.trim();
          if (!name) {
            errorEl.hidden = false;
            errorEl.textContent = '请填写成员姓名';
            nameInput.focus();
            return;
          }
          errorEl.hidden = true;

          const button = modal.querySelector('[data-submit]');
          button.disabled = true;
          const label = button.textContent;
          button.textContent = isEdit ? '保存中…' : '添加中…';

          const payload = {
            name,
            role: form.elements.role.value.trim(),
            email: form.elements.email.value.trim(),
            color,
          };

          try {
            const saved = isEdit ? await updateMember(member.id, payload) : await createMember(payload);
            toast(isEdit ? '成员信息已更新' : `已添加成员 ${saved.name}`, 'success', 2000);
            close({ skipDismiss: true });
            onSaved?.(saved);
          } catch (error) {
            button.disabled = false;
            button.textContent = label;
            const detail = error.details?.[0];
            if (detail) {
              errorEl.hidden = false;
              errorEl.textContent = detail.message;
            }
            toast(error.message, 'error');
          }
        };

        modal.querySelector('[data-submit]').addEventListener('click', submit);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          submit();
        });
        modal.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
            event.preventDefault();
            submit();
          }
        });
      },
    },
  );
}

/** 删除成员：可把名下任务转交给其他成员，避免任务丢失 */
export function openMemberDeleteDialog({ member, taskCount = 0 }) {
  const others = state.members.filter((item) => item.id !== member.id);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    show(
      `<div class="modal-head">
        <h3>移除成员</h3>
        <button class="btn btn-ghost btn-sm" data-close aria-label="关闭">${icon('close', 15)}</button>
      </div>
      <div class="modal-body">
        <p class="modal-text">将移除 <strong>${escapeHtml(member.name)}</strong>（${escapeHtml(
          member.role,
        )}），该成员的历史操作记录会保留。</p>
        ${
          taskCount
            ? `<div class="field" style="margin-top:12px">
                <span>名下 ${taskCount} 个任务如何处理</span>
                <select name="reassignTo">
                  <option value="">转为未指派</option>
                  ${others
                    .map(
                      (item) =>
                        `<option value="${item.id}">转交给 ${escapeHtml(item.name)} · ${escapeHtml(
                          item.role,
                        )}</option>`,
                    )
                    .join('')}
                </select>
              </div>`
            : `<p class="modal-text" style="margin-top:8px;color:var(--text-3)">该成员名下没有任务。</p>`
        }
      </div>
      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="btn" data-close>取消</button>
        <button class="btn btn-danger" data-confirm>移除成员</button>
      </div>`,
      {
        onDismiss() {
          finish(false);
        },
        onMount({ close, modal }) {
          modal.querySelectorAll('[data-close]').forEach((btn) => {
            btn.addEventListener('click', () => {
              finish(false);
              close();
            });
          });
          modal.querySelector('[data-confirm]').addEventListener('click', async () => {
            const button = modal.querySelector('[data-confirm]');
            const select = modal.querySelector('[name="reassignTo"]');
            button.disabled = true;
            button.textContent = '处理中…';
            try {
              const result = await removeMember(member.id, select?.value || null);
              const to = result?.to ? memberById(result.to)?.name : null;
              toast(
                result?.reassigned
                  ? `已移除 ${member.name}，${result.reassigned} 个任务${to ? `转交给 ${to}` : '转为未指派'}`
                  : `已移除 ${member.name}`,
                'success',
                2400,
              );
              finish(true);
              close();
            } catch (error) {
              button.disabled = false;
              button.textContent = '移除成员';
              toast(error.message, 'error');
            }
          });
        },
      },
    );
  });
}

const FALLBACK_TONES = [
  { id: 'neutral', name: '中性', color: '#8b93a7' },
  { id: 'active', name: '进行中', color: '#5b5bd6' },
  { id: 'review', name: '评审', color: '#d97706' },
  { id: 'done', name: '完成', color: '#12866f' },
];

function columnTones() {
  return state.meta.columnTones?.length ? state.meta.columnTones : FALLBACK_TONES;
}

/** 新增 / 编辑看板列：名称、配色、WIP 上限、完成列与开始列语义 */
export function openColumnModal({ column = null } = {}) {
  const isEdit = Boolean(column);
  let tone = column?.tone ?? 'neutral';
  const toneColor = (id) => (columnTones().find((item) => item.id === id) ?? FALLBACK_TONES[0]).color;

  show(
    `<div class="modal-head">
      <h3>${isEdit ? `编辑列「${escapeHtml(column.name)}」` : '新增看板列'}</h3>
      <button class="btn btn-ghost btn-sm" data-close aria-label="关闭">${icon('close', 15)}</button>
    </div>
    <form class="modal-body" id="column-form" novalidate>
      <div class="column-preview">
        <span class="col-dot ${tone}" data-preview-dot></span>
        <strong data-preview-name>${escapeHtml(column?.name ?? '新列')}</strong>
        <span class="column-preview-count">${column?.taskCount ?? 0}</span>
        <span class="column-preview-hint">列预览</span>
      </div>
      <div class="field">
        <span>列名称</span>
        <input type="text" name="name" maxlength="16" autocomplete="off" placeholder="如：待验收" value="${escapeHtml(
          column?.name ?? '',
        )}" />
        <span class="field-error" data-error hidden></span>
      </div>
      <div class="field">
        <span>配色</span>
        <div class="color-picker">
          ${columnTones()
            .map(
              (item) =>
                `<button type="button" class="color-dot ${item.id === tone ? 'on' : ''}" data-tone="${
                  item.id
                }" style="background:${item.color}" title="${escapeHtml(item.name)}" aria-label="选择配色 ${escapeHtml(
                  item.name,
                )}"></button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="field-row two">
        <label class="field">
          <span>WIP 上限</span>
          <input type="number" name="wipLimit" min="1" max="99" placeholder="留空表示不限制" value="${
            column?.wipLimit ?? ''
          }" />
          <span class="field-hint">超出后列头计数变红提醒</span>
        </label>
        <div class="field">
          <span>列语义</span>
          <label class="checkbox-row"><input type="checkbox" name="isDone" ${
            column?.isDone ? 'checked' : ''
          } /> 完成列（进入即视为完成）</label>
          <label class="checkbox-row"><input type="checkbox" name="isStart" ${
            column?.isStart ? 'checked' : ''
          } /> 开始列（用于计算周期时间）</label>
        </div>
      </div>
      <p class="field-hint">完成列决定完成时间、完成率与逾期判断；开始列决定周期时间的起点。</p>
    </form>
    <div class="modal-foot">
      <span class="spacer"></span>
      <button class="btn" data-close>取消</button>
      <button class="btn btn-primary" data-submit>${isEdit ? '保存' : '创建列'}</button>
    </div>`,
    {
      onMount({ close, modal }) {
        const form = modal.querySelector('#column-form');
        const nameInput = form.elements.name;
        const errorEl = form.querySelector('[data-error]');
        const previewName = form.querySelector('[data-preview-name]');
        const previewDot = form.querySelector('[data-preview-dot]');
        nameInput.focus();
        nameInput.select();

        const syncPreview = () => {
          previewName.textContent = nameInput.value.trim() || '新列';
        };
        nameInput.addEventListener('input', syncPreview);

        modal.querySelectorAll('[data-tone]').forEach((dot) => {
          dot.addEventListener('click', () => {
            tone = dot.dataset.tone;
            previewDot.className = `col-dot ${tone}`;
            modal.querySelectorAll('[data-tone]').forEach((item) => item.classList.toggle('on', item === dot));
          });
        });
        modal.querySelectorAll('[data-close]').forEach((btn) => {
          btn.addEventListener('click', () => close());
        });

        const submit = async () => {
          const name = nameInput.value.trim();
          if (!name) {
            errorEl.hidden = false;
            errorEl.textContent = '请填写列名称';
            nameInput.focus();
            return;
          }
          errorEl.hidden = true;

          const button = modal.querySelector('[data-submit]');
          const label = button.textContent;
          button.disabled = true;
          button.textContent = isEdit ? '保存中…' : '创建中…';

          const wipRaw = form.elements.wipLimit.value.trim();
          const payload = {
            name,
            tone,
            wipLimit: wipRaw === '' ? null : Number(wipRaw),
            isDone: form.elements.isDone.checked,
            isStart: form.elements.isStart.checked,
          };

          try {
            const saved = isEdit ? await updateColumn(column.id, payload) : await createColumn(payload);
            toast(isEdit ? '看板列已更新' : `已创建看板列「${saved.name}」`, 'success', 2000);
            close({ skipDismiss: true });
          } catch (error) {
            button.disabled = false;
            button.textContent = label;
            const detail = error.details?.[0];
            if (detail) {
              errorEl.hidden = false;
              errorEl.textContent = detail.message;
            }
            toast(error.message, 'error');
          }
        };

        modal.querySelector('[data-submit]').addEventListener('click', submit);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          submit();
        });
        modal.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
            event.preventDefault();
            submit();
          }
        });
      },
    },
  );
}

/** 删除看板列：任务必须迁移到其他列，历史状态一并归入目标列 */
export function openColumnDeleteDialog({ column }) {
  const others = columns().filter((item) => item.id !== column.id);
  const taskCount = column.taskCount ?? state.tasks.filter((task) => task.status === column.id).length;
  const index = columns().findIndex((item) => item.id === column.id);
  const suggested = columns()[index - 1] ?? columns()[index + 1] ?? null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    show(
      `<div class="modal-head"><h3>删除看板列</h3></div>
      <div class="modal-body">
        <p class="confirm-text">即将删除列「${escapeHtml(column.name)}」${
          taskCount ? `，该列下 <strong>${taskCount}</strong> 个任务需要转移到其他列。` : '。'
        }</p>
        ${
          others.length
            ? `<label class="field">
                 <span>任务转移到</span>
                 <select name="moveTo">
                   ${others
                     .map(
                       (item) =>
                         `<option value="${item.id}" ${
                           item.id === suggested?.id ? 'selected' : ''
                         }>${escapeHtml(item.name)}</option>`,
                     )
                     .join('')}
                 </select>
               </label>
               <p class="field-hint">任务历史中的旧列记录会一并归入目标列，保证累计流图与周期统计连续。</p>`
            : `<p class="confirm-text" style="color:var(--red)">至少需要保留一个看板列，当前无法删除。</p>`
        }
      </div>
      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="btn" data-cancel>取消</button>
        <button class="btn btn-danger" data-confirm ${others.length ? '' : 'disabled'}
          style="background:#e5484d;border-color:#e5484d">删除列</button>
      </div>`,
      {
        onDismiss() {
          finish(false);
        },
        onMount({ close, modal }) {
          modal.querySelector('[data-cancel]').addEventListener('click', () => {
            finish(false);
            close();
          });
          const confirm = modal.querySelector('[data-confirm]');
          if (!others.length) return;
          confirm.addEventListener('click', async () => {
            const moveTo = modal.querySelector('select[name="moveTo"]').value;
            confirm.disabled = true;
            confirm.textContent = '删除中…';
            try {
              const result = await removeColumn(column.id, moveTo);
              toast(
                result?.moved
                  ? `已删除列「${column.name}」，${result.moved} 个任务已转移`
                  : `已删除列「${column.name}」`,
                'success',
                2400,
              );
              finish(true);
              close({ skipDismiss: true });
            } catch (error) {
              confirm.disabled = false;
              confirm.textContent = '删除列';
              toast(error.message, 'error');
            }
          });
        },
      },
    );
  });
}
