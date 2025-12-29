import { createContext, useContext } from 'react';

export const LoadingContext = createContext({
    stage: '',
    setStage: () => { }
});

export const useLoadingContext = () => useContext(LoadingContext);
