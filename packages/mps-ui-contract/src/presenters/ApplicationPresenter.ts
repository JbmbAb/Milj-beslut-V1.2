import { ApplicationViewModel } from "../viewmodels/ApplicationViewModel.js";

export interface ApplicationPresenter {
    present(viewModel: ApplicationViewModel): void;
}
