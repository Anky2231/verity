import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const flagKey = new PluginKey('verityFlags');

// Renders review findings as inline decorations. Decorations are mapped through every edit,
// so highlights follow the text as the creator fixes things.
export const FlagHighlights = Extension.create({
  name: 'verityFlags',
  addOptions() { return { onSelect: () => {} }; },
  addProseMirrorPlugins() {
    const { onSelect } = this.options;
    return [new Plugin({
      key: flagKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const meta = tr.getMeta(flagKey);
          if (meta) {
            return DecorationSet.create(tr.doc, meta.flags.map((f) =>
              Decoration.inline(f.from, f.to, {
                class: `flag flag-${f.severity}${f.active ? ' flag-active' : ''}`,
                'data-flag': String(f.id),
              })));
          }
          return set.map(tr.mapping, tr.doc);
        },
      },
      props: {
        decorations: (state) => flagKey.getState(state),
        handleDOMEvents: {
          click(_view, event) {
            const el = event.target.closest?.('[data-flag]');
            if (el) onSelect(el.getAttribute('data-flag'));
            return false;
          },
        },
      },
    })];
  },
});
