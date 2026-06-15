import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type AppState = {
  isBunchingEnabled: boolean;
  isBunchingRunning: boolean;
  bunchingFlop: number[];
  isSolverRunning: boolean;
  isSolverPaused: boolean;
  isSolverFinished: boolean;
  isSolverError: boolean;
  isFinalizing: boolean;
};

const initialState: AppState = {
  isBunchingEnabled: false,
  isBunchingRunning: false,
  bunchingFlop: [],
  isSolverRunning: false,
  isSolverPaused: false,
  isSolverFinished: false,
  isSolverError: false,
  isFinalizing: false,
};

const appSlice = createSlice({
  name: "app",
  initialState,
  reducers: {
    setBunchingEnabled(state, action: PayloadAction<boolean>) {
      state.isBunchingEnabled = action.payload;
    },
    setBunchingRunning(state, action: PayloadAction<boolean>) {
      state.isBunchingRunning = action.payload;
    },
    setBunchingFlop(state, action: PayloadAction<number[]>) {
      state.bunchingFlop = action.payload;
    },
    setSolverRunning(state, action: PayloadAction<boolean>) {
      state.isSolverRunning = action.payload;
    },
    setSolverPaused(state, action: PayloadAction<boolean>) {
      state.isSolverPaused = action.payload;
    },
    setSolverFinished(state, action: PayloadAction<boolean>) {
      state.isSolverFinished = action.payload;
    },
    setSolverError(state, action: PayloadAction<boolean>) {
      state.isSolverError = action.payload;
    },
    setFinalizing(state, action: PayloadAction<boolean>) {
      state.isFinalizing = action.payload;
    },
  },
});

export const {
  setBunchingEnabled,
  setBunchingRunning,
  setBunchingFlop,
  setSolverRunning,
  setSolverPaused,
  setSolverFinished,
  setSolverError,
  setFinalizing,
} = appSlice.actions;

export default appSlice.reducer;
