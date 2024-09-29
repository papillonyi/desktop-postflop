<template>
  <div
    v-if="!store.isSolverFinished"
    class="flex w-full max-w-screen-xl mx-auto px-4 py-6 items-center"
  >
    <span
      v-if="store.isSolverRunning || store.isFinalizing"
      class="spinner inline-block mr-3"
    ></span>
    {{
      !store.hasSolverRun
        ? "Solver has not run."
        : store.isSolverRunning
        ? "Solver running..."
        : store.isFinalizing
        ? "Finalizing..."
        : store.isSolverError
        ? "Solver error."
        : "Solver paused."
    }}
  </div>

  <div v-else class="flex flex-col h-full">
    <ResultNav
      :cards="cards"
      :dealt-card="dealtCard"
      :is-handler-updated="isHandlerUpdated"
      :is-locked="isLocked"
      @update:is-handler-updated="(value) => (isHandlerUpdated = value)"
      @update:is-locked="(value) => (isLocked = value)"
      @trigger-update="onUpdateSpot"
    />

    <ResultMiddle
      :auto-player-basics="autoPlayerBasics"
      :auto-player-chance="autoPlayerChance"
      :chance-mode="chanceMode"
      :copy-success="copySuccess"
      :display-mode="displayMode"
      @update:display-mode="updateDisplayMode"
      @update:display-options="updateDisplayOptions"
      @copy-to-clipboard="copyRangeTextToClipboard"
      @reset-copy-success="resetCopySuccess"
    />

    <div
      v-if="store.navView === 'results' && selectedSpot && results"
      class="flex flex-grow min-h-0"
    >
      <template v-if="displayMode === 'basics'">
        <ResultBasics
          :cards="cards"
          :current-board="currentBoard"
          :display-options="displayOptions"
          :display-player="displayPlayerBasics"
          :is-compare-mode="false"
          :results="results"
          :selected-chance="selectedChance"
          :selected-spot="selectedSpot"
          :total-bet-amount="totalBetAmount"
          style="flex: 4"
          @update-hover-content="onUpdateHoverContent"
        />

        <ResultTable
          :cards="cards"
          :display-player="displayPlayerBasics"
          :hover-content="basicsHoverContent"
          :results="results"
          :selected-spot="selectedSpot"
          style="flex: 3"
          table-mode="basics"
        />
      </template>

      <template v-else-if="displayMode === 'graphs'">
        <ResultGraphs
          :cards="cards"
          :chance-reports="chanceReports"
          :display-options="displayOptions"
          :display-player="displayPlayerBasics"
          :results="results"
          :selected-chance="selectedChance"
          :selected-spot="selectedSpot"
        />
      </template>

      <template v-else-if="displayMode === 'compare'">
        <ResultBasics
          :cards="cards"
          :current-board="currentBoard"
          :display-options="displayOptions"
          :is-compare-mode="true"
          :results="results"
          :selected-chance="selectedChance"
          :selected-spot="selectedSpot"
          :total-bet-amount="totalBetAmount"
          display-player="oop"
          style="flex: 5"
        />

        <ResultCompare
          :results="results"
          :selected-chance="selectedChance"
          :selected-spot="selectedSpot"
          style="flex: 2"
        />

        <ResultBasics
          :cards="cards"
          :current-board="currentBoard"
          :display-options="displayOptions"
          :is-compare-mode="true"
          :results="results"
          :selected-chance="selectedChance"
          :selected-spot="selectedSpot"
          :total-bet-amount="totalBetAmount"
          display-player="ip"
          style="flex: 5"
        />
      </template>

      <template v-else-if="displayMode === 'chance' && selectedChance">
        <ResultChance
          :chance-reports="chanceReports"
          :display-options="displayOptions"
          :display-player="displayPlayerChance"
          :selected-chance="selectedChance"
          :selected-spot="selectedSpot"
          @deal-card="onDealCard"
        />
      </template>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { useStore } from "../store";
import * as invokes from "../invokes";

import {
  ChanceReports,
  DisplayMode,
  DisplayOptions,
  HoverContent,
  Results,
  Spot,
  SpotChance,
  SpotPlayer,
} from "../result-types";

import ResultNav from "./ResultNav.vue";
import ResultMiddle from "./ResultMiddle.vue";
import ResultBasics from "./ResultBasics.vue";
import ResultTable from "./ResultTable.vue";
import ResultCompare from "./ResultCompare.vue";
import ResultGraphs from "./ResultGraphs.vue";
import ResultChance from "./ResultChance.vue";

const store = useStore();

/* Navigation */

const isHandlerUpdated = ref(false);
const isLocked = ref(false);

const cards = ref<number[][]>([[], []]);
const dealtCard = ref(-1);

const selectedSpot = ref<Spot | null>(null);
const selectedChance = ref<SpotChance | null>(null);
const currentBoard = ref<number[]>([]);
const results = ref<Results | null>(null);
const chanceReports = ref<ChanceReports | null>(null);
const totalBetAmount = ref([0, 0]);

const isSolverFinished = ref(false);
store.$subscribe(async (_, store) => {
  if (isSolverFinished.value !== store.isSolverFinished) {
    if ((isSolverFinished.value = store.isSolverFinished)) {
      await init();
    } else {
      clear();
    }
  }
});

const init = async () => {
  cards.value = await invokes.gamePrivateCards();
  isHandlerUpdated.value = true;
};

const clear = () => {
  cards.value = [[], []];
  selectedSpot.value = null;
  selectedChance.value = null;
  results.value = null;
  chanceReports.value = null;
};

const onUpdateSpot = (
  newSelectedSpot: Spot | null,
  newSelectedChance: SpotChance | null,
  newCurrentBoard: number[],
  newResults: Results,
  newChanceReports: ChanceReports | null,
  newTotalBetAmount: number[]
) => {
  dealtCard.value = -1;
  selectedSpot.value = newSelectedSpot;
  selectedChance.value = newSelectedChance;
  currentBoard.value = newCurrentBoard;
  results.value = newResults;
  chanceReports.value = newChanceReports;
  totalBetAmount.value = newTotalBetAmount;
  isLocked.value = false;

  chanceMode.value = newSelectedChance?.player ?? "";
};

/* Middle Bar */

const displayMode = ref<DisplayMode>("basics");
const chanceMode = ref("");

const displayOptions = ref<DisplayOptions>({
  playerBasics: "auto",
  playerChance: "auto",
  barHeight: "normalized",
  suit: "grouped",
  strategy: "show",
  contentBasics: "default",
  contentGraphs: "eq",
  chartChance: "strategy-combos",
});

const copySuccess = ref(0);

const updateDisplayMode = (mode: DisplayMode) => {
  displayMode.value = mode;
};

const updateDisplayOptions = (options: DisplayOptions) => {
  displayOptions.value = options;
};

const copyRangeTextToClipboard = async () => {
  const text = "Hello World";
  navigator.clipboard
    .writeText(text)
    .then(() => (copySuccess.value = 1))
    .catch(() => (copySuccess.value = -1));
};

const resetCopySuccess = () => {
  copySuccess.value = 0;
};

/* Computed */

const autoPlayerBasics = computed(() => {
  const spot = selectedSpot.value;
  const chance = selectedChance.value;
  if (!spot) return "oop";

  if (chance) {
    return chance.prevPlayer;
  } else if (spot.type === "terminal") {
    return spot.prevPlayer;
  } else {
    return (spot as SpotPlayer).player;
  }
});

const autoPlayerChance = computed(() => {
  const spot = selectedSpot.value;
  if (!spot) return "oop";
  if (spot.type === "terminal") {
    return spot.prevPlayer;
  } else {
    return (spot as SpotPlayer).player;
  }
});

const displayPlayerBasics = computed(() => {
  const optionPlayer = displayOptions.value.playerBasics;
  if (optionPlayer === "auto") {
    return autoPlayerBasics.value;
  } else {
    return optionPlayer;
  }
});

const displayPlayerChance = computed(() => {
  const optionPlayer = displayOptions.value.playerChance;
  if (optionPlayer === "auto") {
    return autoPlayerChance.value;
  } else {
    return optionPlayer;
  }
});

/* Results */

const basicsHoverContent = ref<HoverContent | null>(null);

const onUpdateHoverContent = (content: HoverContent | null) => {
  basicsHoverContent.value = content;
};

const onDealCard = (card: number) => {
  dealtCard.value = card;
};
</script>
