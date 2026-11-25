// Il pannello "Tag": spunta i tag che ci sono già o scrivine uno nuovo, per una cartella, una
// playlist, un brano o più brani selezionati. Ogni clic vale subito (src/lib/tags.ts).

import { useEffect, useState, type FormEvent } from 'react'
import { useStore } from '../lib/store'
import { addTag, loadTags, removeTag, tagKey, tagStore, tagsOf, type Tag, type TagTarget } from '../lib/tags'
import { Icon } from './icons'
import { closeSheet, showSheet, toast, type MenuItem } from './sheets'
import { errorText } from './text'

const report = (task: Promise<unknown>) => void task.catch((error: unknown) => toast(errorText(error)))

/** Quante delle cose indicate hanno il tag. */
const countIn = (tag: Tag, targets: TagTarget[]) =>
  targets.filter((target) => tag.items.some((item) => item.kind === target.kind && item.id === target.id)).length

function TagPicker({ targets, title }: { targets: TagTarget[]; title: string }) {
  const tags = useStore(tagStore, (state) => state.tags)
  const [text, setText] = useState('')
  // Quelli scelti all'apertura restano in cima anche togliendoli, così la lista non salta.
  const [first] = useState(() => new Set(tags.filter((tag) => countIn(tag, targets) > 0).map((tag) => tagKey(tag.name))))

  useEffect(() => {
    void loadTags()
  }, [])

  const typed = tagKey(text)
  const shown = tags
    .filter((tag) => !typed || tagKey(tag.name).includes(typed))
    .sort((a, b) => Number(first.has(tagKey(b.name))) - Number(first.has(tagKey(a.name))))

  const toggle = (tag: Tag) =>
    report(countIn(tag, targets) === targets.length ? removeTag(tag.name, targets) : addTag(tag.name, targets))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    report(addTag(text, targets))
    setText('')
  }

  return (
    <div className="picker">
      <header className="sheet-head">
        <div className="sheet-title">Tag</div>
        <div className="sheet-sub">{title}</div>
      </header>
      <form className="tag-new" onSubmit={submit}>
        <input
          // Sul telefono la tastiera si apre solo se non c'è ancora nessun tag da spuntare.
          autoFocus={!tags.length}
          value={text}
          placeholder={tags.length ? 'Cerca o scrivi un tag nuovo' : 'Nuovo tag (es. cena, corsa, anni 80)'}
          aria-label="Tag"
          onChange={(event) => setText(event.target.value)}
        />
        <button className="pill primary" type="submit" disabled={!text.trim()}>
          <Icon name="plus" size={16} /> Aggiungi
        </button>
      </form>
      {shown.length > 0 && (
        <ul className="menu checklist">
          {shown.map((tag) => {
            const count = countIn(tag, targets)
            return (
              <li key={tag.name}>
                <label>
                  <input
                    type="checkbox"
                    checked={count === targets.length}
                    ref={(input) => {
                      if (input) input.indeterminate = count > 0 && count < targets.length
                    }}
                    onChange={() => toggle(tag)}
                  />
                  <span>{tag.name}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {!tags.length && <p className="menu-note">Un tag raggruppa cartelle, playlist e brani: poi lo trovi in "Tag" e nella ricerca.</p>}
      <div className="dialog-actions picker-actions">
        <button className="primary" onClick={closeSheet}>
          Fatto
        </button>
      </div>
    </div>
  )
}

export function openTagPicker(targets: TagTarget[], title: string) {
  if (targets.length) showSheet(<TagPicker targets={targets} title={title} />)
}

/** La voce "Tag…" dei menu ⋯, con i tag che ha già (se è una cosa sola). */
export function tagMenuItem(targets: TagTarget[], title: string): MenuItem {
  const current = targets.length === 1 ? tagsOf(tagStore.get().tags, targets[0]).map((tag) => tag.name) : []
  return {
    label: current.length ? `Tag: ${current.join(', ')}` : 'Tag…',
    icon: 'tag',
    onSelect: () => openTagPicker(targets, title),
  }
}
