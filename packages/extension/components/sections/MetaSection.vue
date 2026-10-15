<script setup lang="ts">
import Badge from '@/components/Badge.vue'
import Copyable from '@/components/Copyable.vue'
import IconButton from '@/components/IconButton.vue'
import Link from '@/components/icons/Link.vue'
import Plus from '@/components/icons/Plus.vue'
import Refresh from '@/components/icons/Refresh.vue'
import Select from '@/components/icons/Select.vue'
import Section from '@/components/Section.vue'
import { refreshDevResourceLinks, useDevResourceLinks, useToast } from '@/composables'
import {
  activeFocusId,
  activeFocusNode,
  figmaSelection,
  pinFromFigmaSelection,
  selection,
  selectionRevision,
  selectedTemPadComponent
} from '@/ui/state'

const { show } = useToast()

const title = computed(() => {
  void selectionRevision.value
  const focusedNode = activeFocusId.value ? activeFocusNode.value : null
  if (focusedNode) {
    return selectedTemPadComponent.value?.name ?? focusedNode.name
  }

  const nodes = selection.value
  const [node] = nodes

  if (!node) {
    return null
  }

  if (nodes.length > 1) {
    return `${nodes.length} Selected`
  }

  const component = selectedTemPadComponent.value
  if (component) {
    return component.name
  }

  return node.name
})

const showFocusButton = computed(() => !!activeFocusNode.value && !!window.figma)

const canPin = computed(() => figmaSelection.value.some((node) => node.visible))

const devResourceLinks = useDevResourceLinks(activeFocusNode)
const refreshingNode = shallowRef<SceneNode | null>(null)
const refreshing = computed(
  () => !!activeFocusNode.value && refreshingNode.value === activeFocusNode.value
)

async function refreshLinks() {
  const node = activeFocusNode.value
  if (!node || refreshing.value) return
  refreshingNode.value = node
  try {
    await refreshDevResourceLinks(node)
  } catch {
    if (activeFocusNode.value === node) show('Could not refresh links. Try again.')
  } finally {
    if (refreshingNode.value === node) refreshingNode.value = null
  }
}

const libDisplayName = computed(() => selectedTemPadComponent.value?.libDisplayName)

const libName = computed(() => selectedTemPadComponent.value?.libName)

function scrollIntoView() {
  const node = activeFocusNode.value
  if (!window?.figma || !node) {
    return
  }
  window.figma.viewport.scrollAndZoomIntoView([node])
}

function pinSelection() {
  const result = pinFromFigmaSelection()
  if (result.ok) {
    show(result.added === 1 ? 'Pinned 1 layer' : `Pinned ${result.added} layers`)
    return
  }
  if (result.reason === 'empty') {
    show('Select a visible layer to pin')
    return
  }
  show('TemPad is not ready')
}
</script>

<template>
  <Section flat>
    <template #header>
      <div class="tp-meta-title tp-row tp-shrink tp-gap-l" v-if="title != null">
        <Copyable
          class="tp-ellipsis"
          :data-tooltip="`Click to copy layer name: ${title}`"
          data-tooltip-type="text"
        >
          {{ title }}
        </Copyable>
        <Copyable v-if="libName" variant="block" :data-copy="libName">
          <Badge :title="libName">{{ libDisplayName || libName }}</Badge>
        </Copyable>
      </div>
      <span class="tp-meta-title-aux tp-ellipsis" v-else>No focus</span>
      <div class="tp-row tp-gap-l">
        <IconButton title="Pin current Figma selection" :disabled="!canPin" @click="pinSelection">
          <Plus />
        </IconButton>
        <IconButton
          v-if="activeFocusNode"
          title="Refresh links"
          :disabled="refreshing"
          @click="refreshLinks"
        >
          <Refresh :spin="refreshing" />
        </IconButton>
        <IconButton
          v-if="showFocusButton"
          title="Scroll into view"
          class="tp-meta-scroll"
          @click="scrollIntoView"
        >
          <Select />
        </IconButton>
      </div>
    </template>
    <div v-if="devResourceLinks.length > 0" class="tp-meta-dev-links">
      <a
        class="tp-row tp-meta-dev-link"
        :href="link.url"
        target="_blank"
        v-for="link in devResourceLinks"
        :key="link.url"
      >
        <div class="tp-meta-dev-link-icon">
          <img class="tp-meta-dev-link-favicon" v-if="link.favicon" :src="link.favicon" />
          <Link class="tp-meta-dev-link-fallback-icon" v-else />
        </div>
        <span class="tp-meta-dev-link-label">{{ link.name }}</span>
      </a>
    </div>
  </Section>
</template>

<style scoped>
.tp-meta-title {
  font-family: var(--text-body-large-strong-font-family);
  font-size: var(--text-body-large-strong-font-size);
  font-weight: var(--text-body-large-strong-font-weight);
  letter-spacing: var(--text-body-large-strong-letter-spacing);
  line-height: var(--text-body-large-strong-line-height);
  color: var(--color-text);
}

.tp-meta-title-aux {
  color: var(--color-text-secondary);
}

.tp-meta-dev-links {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 12px;
}

.tp-meta-dev-link {
  position: relative;
  font-family: var(--text-body-medium-font-family);
  font-size: var(--text-body-medium-font-size);
  font-weight: var(--text-body-medium-font-weight);
  letter-spacing: var(--text-body-medium-letter-spacing);
  line-height: var(--text-body-medium-line-height);
  height: 24px;
  gap: 4px;
  overflow-wrap: break-word;
  cursor: pointer;
}

.tp-meta-dev-link:hover::after {
  content: '';
  position: absolute;
  inset: 0 calc(var(--spacer-2, 0.5rem) * -1);
  background: var(--color-bghovertransparent);
  border-radius: var(--fpl-radius-left, var(--radius-medium))
    var(--fpl-radius-right, var(--radius-medium)) var(--fpl-radius-right, var(--radius-medium))
    var(--fpl-radius-left, var(--radius-medium));
}

.tp-meta-dev-link-label {
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-meta-dev-link-favicon {
  width: 16px;
  height: 16px;
  vertical-align: middle;
}

.tp-meta-dev-link-fallback-icon {
  margin-inline: -4px;
}
</style>
