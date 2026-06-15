import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type TreeConfigState = {
  board: number[];
  startingPot: number;
  effectiveStack: number;
  rakePercent: number;
  rakeCap: number;
  donkOption: boolean;
  oopFlopBet: string;
  oopFlopRaise: string;
  oopTurnBet: string;
  oopTurnRaise: string;
  oopTurnDonk: string;
  oopRiverBet: string;
  oopRiverRaise: string;
  oopRiverDonk: string;
  ipFlopBet: string;
  ipFlopRaise: string;
  ipTurnBet: string;
  ipTurnRaise: string;
  ipRiverBet: string;
  ipRiverRaise: string;
  addAllInThreshold: number;
  forceAllInThreshold: number;
  mergingThreshold: number;
  expectedBoardLength: number;
  addedLines: string;
  removedLines: string;
};

export const defaultConfigState: TreeConfigState = {
  board: [],
  startingPot: 20,
  effectiveStack: 100,
  rakePercent: 0,
  rakeCap: 0,
  donkOption: false,
  oopFlopBet: "",
  oopFlopRaise: "",
  oopTurnBet: "",
  oopTurnRaise: "",
  oopTurnDonk: "",
  oopRiverBet: "",
  oopRiverRaise: "",
  oopRiverDonk: "",
  ipFlopBet: "",
  ipFlopRaise: "",
  ipTurnBet: "",
  ipTurnRaise: "",
  ipRiverBet: "",
  ipRiverRaise: "",
  addAllInThreshold: 150,
  forceAllInThreshold: 20,
  mergingThreshold: 10,
  expectedBoardLength: 0,
  addedLines: "",
  removedLines: "",
};

const configSlice = createSlice({
  name: "config",
  initialState: defaultConfigState,
  reducers: {
    setConfig(state, action: PayloadAction<Partial<TreeConfigState>>) {
      Object.assign(state, action.payload);
    },
    setBoard(state, action: PayloadAction<number[]>) {
      state.board = action.payload;
    },
    resetConfig() {
      return defaultConfigState;
    },
  },
});

export const { setConfig, setBoard, resetConfig } = configSlice.actions;
export default configSlice.reducer;
