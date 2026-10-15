<script setup lang="ts">
import IconButton from '@/components/IconButton.vue'
import Select from '@/components/icons/Select.vue'
import Times from '@/components/icons/Times.vue'
import Section from '@/components/Section.vue'
import {
  activeFocusId,
  clearPins,
  pinIds,
  setActiveFocus,
  unpinById,
  workingNodes
} from '@/ui/state'

const pinRows = computed(() => {
  const nodesById = new Map(workingNodes.value.map((node) => [node.id, node]))
  return pinIds.value.map((id) => {
    const node = nodesById.get(id)
    return {
      id,
      name: node?.name ?? id,
      missing: !node,
      focused: id === activeFocusId.value
    }
  })
})

const hasPins = computed(() => pinIds.value.length > 0)

function focusPin(id: string) {
  setActiveFocus(id)
}

function scrollPin(id: string) {
  setActiveFocus(id)
  const node = workingNodes.value.find((entry) => entry.id === id)
  if (!window?.figma || !node) return
  window.figma.viewport.scrollAndZoomIntoView([node])
}
</script>

<template>
  <Section>
    <template #header>
      <div class="tp-pins-title tp-row tp-shrink tp-gap-l">
        <span>Pins</span>
        <span v-if="hasPins" class="tp-pins-count">{{ pinIds.length }}</span>
      </div>
      <IconButton v-if="hasPins" title="Clear all pins" @click="clearPins">
        <Times />
      </IconButton>
    </template>

    <p v-if="!hasPins" class="tp-pins-empty">
      Select layers in Figma, then press + to pin them. Pins survive canvas clicks and tab
      refreshes.
    </p>

    <ul v-else class="tp-pins-list">
      <li
        v-for="row in pinRows"
        :key="row.id"
        class="tp-pins-row"
        :class="{ 'tp-pins-row-focused': row.focused, 'tp-pins-row-missing': row.missing }"
      >
        <button type="button" class="tp-pins-name tp-ellipsis" @click="focusPin(row.id)">
          {{ row.name }}
          <span v-if="row.missing" class="tp-pins-missing">missing</span>
        </button>
        <div class="tp-row tp-gap-l">
          <IconButton title="Scroll into view" :disabled="row.missing" @click="scrollPin(row.id)">
            <Select />
          </IconButton>
          <IconButton title="Unpin" @click="unpinById(row.id)">
            <Times />
          </IconButton>
        </div>
      </li>
    </ul>
  </Section>
</template>

<style scoped>
.tp-pins-title {
  font-family: var(--text-body-large-strong-font-family);
  font-size: var(--text-body-large-strong-font-size);
  font-weight: var(--text-body-large-strong-font-weight);
  color: var(--color-text);
}

.tp-pins-count {
  color: var(--color-text-secondary);
  font-weight: var(--text-body-medium-font-weight);
  font-size: var(--text-body-medium-font-size);
}

.tp-pins-empty {
  margin: 0;
  padding-bottom: 8px;
  color: var(--color-text-secondary);
  font-family: var(--text-body-medium-font-family);
  font-size: var(--text-body-medium-font-size);
  line-height: var(--text-body-medium-line-height);
}

.tp-pins-list {
  list-style: none;
  margin: 0;
  padding: 0 0 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tp-pins-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  border-radius: var(--radius-medium);
  padding-inline: 4px;
}

.tp-pins-row-focused {
  background: var(--color-bgselected);
}

.tp-pins-row-missing .tp-pins-name {
  color: var(--color-text-secondary);
  text-decoration: line-through;
}

.tp-pins-name {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--color-text);
  font-family: var(--text-body-medium-font-family);
  font-size: var(--text-body-medium-font-size);
  line-height: var(--text-body-medium-line-height);
  padding: 4px 0;
}

.tp-pins-missing {
  margin-left: 6px;
  text-decoration: none;
  font-size: 11px;
}
</style>
