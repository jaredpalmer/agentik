import {
  SelectRenderable,
  SelectRenderableEvents,
  type SelectRenderableOptions,
  type SelectOption,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core";

export type SelectItem = {
  value: string;
  label: string;
  description?: string;
};

export type SelectListOptions = {
  items: SelectItem[];
  selectedIndex?: number;
  maxVisible?: number;
  showDescription?: boolean;
  wrapSelection?: boolean;
  onSelect?: (item: SelectItem) => void;
  onSelectionChange?: (item: SelectItem) => void;
  onCancel?: () => void;
  renderable?: Omit<
    SelectRenderableOptions,
    "options" | "selectedIndex" | "showDescription" | "wrapSelection"
  >;
};

export class SelectList {
  readonly view: SelectRenderable;

  private items: SelectItem[] = [];
  private filteredItems: SelectItem[] = [];
  private filterText = "";
  private onSelect?: (item: SelectItem) => void;
  private onSelectionChange?: (item: SelectItem) => void;

  constructor(renderer: CliRenderer, options: SelectListOptions) {
    this.items = options.items;
    this.filteredItems = options.items;
    this.onSelect = options.onSelect;
    this.onSelectionChange = options.onSelectionChange;

    const baseOptions: SelectRenderableOptions = {
      ...(options.renderable ?? {}),
      options: this.toOptions(this.filteredItems),
      selectedIndex: options.selectedIndex ?? 0,
      showDescription: options.showDescription ?? true,
      wrapSelection: options.wrapSelection ?? true,
    };

    if (options.maxVisible) {
      const itemSpacing = baseOptions.itemSpacing ?? 0;
      const linesPerItem = (baseOptions.showDescription ? 2 : 1) + itemSpacing;
      baseOptions.height = options.maxVisible * linesPerItem;
    }

    if (options.onCancel) {
      const userOnKeyDown = baseOptions.onKeyDown;
      baseOptions.onKeyDown = (key: KeyEvent) => {
        if (key.name === "escape") {
          options.onCancel?.();
        }
        userOnKeyDown?.(key);
      };
    }

    this.view = new SelectRenderable(renderer, baseOptions);

    this.view.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
      const item = this.filteredItems[index];
      if (item) {
        this.onSelect?.(item);
      }
    });

    this.view.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
      const item = this.filteredItems[index];
      if (item) {
        this.onSelectionChange?.(item);
      }
    });
  }

  setItems(items: SelectItem[]): void {
    this.items = items;
    this.applyFilter(this.filterText);
  }

  setFilter(filter: string): void {
    this.filterText = filter;
    this.applyFilter(filter);
  }

  clearFilter(): void {
    this.setFilter("");
  }

  getSelectedItem(): SelectItem | null {
    const index = this.view.getSelectedIndex();
    return this.filteredItems[index] ?? null;
  }

  setSelectedIndex(index: number): void {
    this.view.setSelectedIndex(index);
  }

  private applyFilter(filter: string): void {
    const normalized = filter.trim().toLowerCase();
    if (!normalized) {
      this.filteredItems = [...this.items];
    } else {
      this.filteredItems = this.items.filter((item) => {
        const label = (item.label || item.value).toLowerCase();
        const value = item.value.toLowerCase();
        return label.startsWith(normalized) || value.startsWith(normalized);
      });
    }

    this.view.options = this.toOptions(this.filteredItems);
    this.view.setSelectedIndex(0);
  }

  private toOptions(items: SelectItem[]): SelectOption[] {
    return items.map((item) => ({
      name: item.label || item.value,
      description: item.description ?? "",
      value: item.value,
    }));
  }
}
