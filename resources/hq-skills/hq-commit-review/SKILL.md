---
name: hq-commit-review
description: Фоновое ревью Codex новых коммитов владельца во всех проектах HQ (фоновая задача com.orca-plus.commit-review раз в 20 минут; включает hq-setup) — только проблемы P0/P1 становятся отчётом HQ/updates/codex-review-<время>.md (колокольчик, баннер, пуш). Триггеры — «прогони ревью коммитов», «что нашёл Codex», «почему Codex не проверил коммит», «ревьюер коммитов», статус очереди ревью.
---

# Ревью коммитов Codex по всем проектам

Скрипт `review.py` рядом, без модели Claude: сам находит новые коммиты и сам зовёт `codex review`. Нужен Codex CLI, вошедший в аккаунт (`codex login`).

- **Что смотрит:** проекты из `HQ/registry.yaml` (git, local); локальные ветки с коммитами за 3 дня; только коммиты владельца (`user.email` репо или глобальный), без merge. Перебазированная копия уже проверенного коммита (тот же patch-id) не проверяется второй раз.
- **Как:** `codex review --commit <sha> -c model=gpt-6-sol -c sandbox_mode="read-only"`, до 6 коммитов за запуск (`COMMIT_REVIEW_MAX`), старые первыми; упёрлись в лимит Codex — остаток ждёт следующего запуска.
- **Куда:** есть P0/P1 → `HQ/updates/codex-review-<YYYY-MM-DDTHH-MM>.md` (Orca+ HQ → Reports + колокольчик). Чисто или только P2 → строка в `~/Library/Logs/orca-plus-commit-review.log`.
- **Состояние:** `HQ/codex-review/state.json` (вне git): проверенные sha и patch-id, последние 500 ревью с уровнями.

Команды:
- `python3 "${CLAUDE_SKILL_DIR}/review.py" status` — сколько коммитов в очереди по проектам.
- `bash "${CLAUDE_SKILL_DIR}/run.sh"` — прогнать сейчас.
- `python3 "${CLAUDE_SKILL_DIR}/review.py" baseline` — пометить всё текущее проверенным (после долгого простоя, чтобы не жечь лимит на старое).

Ответ владельцу про найденное — по отчёту: проект, коммит, что не так; правит агент в том проекте.
