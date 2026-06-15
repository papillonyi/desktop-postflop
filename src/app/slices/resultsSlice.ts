import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type ResultsState = {
  selectedSpotIndex: number;
  selectedChanceIndex: number;
  chanceMode: string;
};

const initialState: ResultsState = {
  selectedSpotIndex: -1,
  selectedChanceIndex: -1,
  chanceMode: "",
};

const resultsSlice = createSlice({
  name: "results",
  initialState,
  reducers: {
    setSelectedSpotIndex(state, action: PayloadAction<number>) {
      state.selectedSpotIndex = action.payload;
    },
    setSelectedChanceIndex(state, action: PayloadAction<number>) {
      state.selectedChanceIndex = action.payload;
    },
    setChanceMode(state, action: PayloadAction<string>) {
      state.chanceMode = action.payload;
    },
  },
});

export const { setSelectedSpotIndex, setSelectedChanceIndex, setChanceMode } =
  resultsSlice.actions;
export default resultsSlice.reducer;
