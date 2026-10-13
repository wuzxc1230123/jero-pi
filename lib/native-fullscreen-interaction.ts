import { Container, type Component, type TuiMouseEvent } from "@earendil-works/pi-tui";

export interface NativeFullscreenMouseObserver {
	beforeMouse(event: TuiMouseEvent): void;
	afterMouse(event: TuiMouseEvent): void;
}

export interface NativeFullscreenInteractionOptions {
	keyboardTarget: Component;
	requestRender(): void;
	mouseObserver?: NativeFullscreenMouseObserver;
}

export class NativeFullscreenInteraction extends Container {
	private readonly options: NativeFullscreenInteractionOptions;

	constructor(options: NativeFullscreenInteractionOptions) {
		super();
		this.options = options;
	}

	handleInput(data: string): void {
		if (!this.options.keyboardTarget.handleInput) return;
		this.options.keyboardTarget.handleInput(data);
		this.options.requestRender();
	}

	override handleMouse(event: TuiMouseEvent) {
		this.options.mouseObserver?.beforeMouse(event);
		try {
			return super.handleMouse(event);
		} finally {
			this.options.mouseObserver?.afterMouse(event);
		}
	}
}

/**
 * 将原生 Container 的鼠标派发与一个拥有键盘的控件组合。
 * 可选的观察者围绕原生委托运行且不改写其结果，
 * 因此原生的布局、命中、焦点、滚轮与点击语义保持完好。
 */
export function createNativeFullscreenInteraction(
	options: NativeFullscreenInteractionOptions,
): NativeFullscreenInteraction {
	return new NativeFullscreenInteraction(options);
}
