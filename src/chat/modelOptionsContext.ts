import { createContext, useContext } from "react";
import type { ChatProvider } from "../../electron/types";
import {
  getModelPickerOptions,
  type ChatModelOption
} from "../../electron/chatModels";

/**
 * The models each provider offers, as Coach last read them
 * (`providerModelOptions` over its settings and Claude Code's status).
 *
 * A context rather than a prop because the pickers sit several components
 * below the screen that holds the settings — an analysis's form is three
 * levels into a modal — and a prop threaded that far is one a new caller
 * forgets, leaving that picker on the shipped list. Outside a provider it
 * answers with the shipped list, which is what a picker showed before.
 */
export const ModelOptionsContext = createContext<
  (provider: ChatProvider) => ChatModelOption[]
>((provider) => getModelPickerOptions(provider));

export function useModelOptions(): (provider: ChatProvider) => ChatModelOption[] {
  return useContext(ModelOptionsContext);
}
