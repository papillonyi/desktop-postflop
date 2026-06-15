import { configureStore } from "@reduxjs/toolkit";
import appReducer from "./slices/appSlice";
import configReducer from "./slices/configSlice";
import rangesReducer from "./slices/rangesSlice";
import resultsReducer from "./slices/resultsSlice";

export const store = configureStore({
  reducer: {
    app: appReducer,
    config: configReducer,
    ranges: rangesReducer,
    results: resultsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
