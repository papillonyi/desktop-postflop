import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type RangesState = {
  values: number[][];
};

const createEmptyRanges = () =>
  Array.from({ length: 6 }, () => Array.from({ length: 13 * 13 }, () => 0));

const initialState: RangesState = {
  values: createEmptyRanges(),
};

const rangesSlice = createSlice({
  name: "ranges",
  initialState,
  reducers: {
    setRangeWeights(
      state,
      action: PayloadAction<{ player: number; weights: number[] }>
    ) {
      state.values[action.payload.player] = action.payload.weights;
    },
    setRangeCell(
      state,
      action: PayloadAction<{
        player: number;
        index: number;
        weight: number;
      }>
    ) {
      state.values[action.payload.player][action.payload.index] =
        action.payload.weight;
    },
  },
});

export const { setRangeWeights, setRangeCell } = rangesSlice.actions;
export default rangesSlice.reducer;
