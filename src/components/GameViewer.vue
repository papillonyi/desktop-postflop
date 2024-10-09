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
    <button class="ml-3 button-base button-blue" @click.stop="initPlayInfo">
      Init
    </button>
    <GameNav
      :is-handler-updated="isHandlerUpdated"
      :is-locked="isLocked"
      :cards="cards"
      :dealt-card="dealtCard"
      @update:is-handler-updated="(value) => (isHandlerUpdated = value)"
      @update:is-locked="(value) => (isLocked = value)"
      @trigger-update="onUpdateSpot"
    />

    <ResultMiddle
      :display-mode="displayMode"
      :chance-mode="chanceMode"
      :auto-player-basics="autoPlayerBasics"
      :auto-player-chance="autoPlayerChance"
      :copy-success="copySuccess"
      @update:display-mode="updateDisplayMode"
      @update:display-options="updateDisplayOptions"
      @copy-to-clipboard="copyRangeTextToClipboard"
      @reset-copy-success="resetCopySuccess"
    />

    <div
      v-if="store.navView === 'game' && selectedSpot && results"
      class="flex flex-grow min-h-0"
    >
      <template v-if="displayMode === 'basics'">
        <ResultBasics
          style="flex: 4"
          :cards="cards"
          :selected-spot="selectedSpot"
          :selected-chance="selectedChance"
          :current-board="currentBoard"
          :total-bet-amount="totalBetAmount"
          :results="results"
          :display-options="displayOptions"
          :display-player="displayPlayerBasics"
          :is-compare-mode="false"
          @update-hover-content="onUpdateHoverContent"
        />

        <GameTable
          style="flex: 3"
          table-mode="basics"
          :cards="cards"
          :selected-spot="selectedSpot"
          :results="results"
          :display-player="displayPlayerBasics"
          :hover-content="basicsHoverContent"
        />
      </template>

      <template v-else-if="displayMode === 'graphs'">
        <ResultGraphs
          :cards="cards"
          :selected-spot="selectedSpot"
          :selected-chance="selectedChance"
          :results="results"
          :chance-reports="chanceReports"
          :display-options="displayOptions"
          :display-player="displayPlayerBasics"
        />
      </template>

      <template v-else-if="displayMode === 'compare'">
        <ResultBasics
          style="flex: 5"
          :cards="cards"
          :selected-spot="selectedSpot"
          :selected-chance="selectedChance"
          :current-board="currentBoard"
          :total-bet-amount="totalBetAmount"
          :results="results"
          :display-options="displayOptions"
          display-player="oop"
          :is-compare-mode="true"
        />

        <ResultCompare
          style="flex: 2"
          :selected-spot="selectedSpot"
          :selected-chance="selectedChance"
          :results="results"
        />

        <ResultBasics
          style="flex: 5"
          :cards="cards"
          :selected-spot="selectedSpot"
          :selected-chance="selectedChance"
          :current-board="currentBoard"
          :total-bet-amount="totalBetAmount"
          :results="results"
          :display-options="displayOptions"
          display-player="ip"
          :is-compare-mode="true"
        />
      </template>

      <template v-else-if="displayMode === 'chance' && selectedChance">
        <GameChance
          :selected-spot="selectedSpot"
          :selected-chance="selectedChance"
          :chance-reports="chanceReports"
          :display-options="displayOptions"
          :display-player="displayPlayerChance"
          @deal-card="onDealCard"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useGameStore, useStore } from "../store";
import * as invokes from "../invokes";

import {
  Results,
  ChanceReports,
  Spot,
  SpotChance,
  SpotPlayer,
  DisplayMode,
  DisplayOptions,
  HoverContent,
} from "../result-types";

import ResultMiddle from "./ResultMiddle.vue";
import ResultBasics from "./ResultBasics.vue";
import ResultCompare from "./ResultCompare.vue";
import ResultGraphs from "./ResultGraphs.vue";
import ResultChance from "./ResultChance.vue";
import GameNav from "./GameNav.vue";
import { getRandomItemByWeight, pairText } from "../utils";
import GameTable from "./GameTable.vue";
import GameChance from "./GameChance.vue";

const store = useStore();

/* Navigation */

const isHandlerUpdated = ref(false);
const isLocked = ref(false);

const cards = ref<number[][]>([[], []]);
const dealtCard = ref(-1);
const gameStore = useGameStore();
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

const initPlayInfo = () => {
  if (!results.value) return;
  const oopCards = getRandomItemByWeight(
    cards.value[0],
    results.value?.weights[0]
  );
  const ipCards = getRandomItemByWeight(
    cards.value[1],
    results.value?.weights[1]
  );
  gameStore.playersInfo = [];
  gameStore.playersInfo.push({
    cards: oopCards,
    card1: oopCards & 0xff,
    card2: oopCards >>> 8,
  });

  gameStore.playersInfo.push({
    cards: ipCards,
    card1: ipCards & 0xff,
    card2: ipCards >>> 8,
  });
  gameStore.playerPositionInt = Math.random() < 0.5 ? 0 : 1;

  console.log(
    "position",
    gameStore.playerPositionInt,
    pairText(gameStore.playersInfo[0].cards),
    pairText(gameStore.playersInfo[1].cards)
  );
  // gameStore.rest = false;
};
</script>
