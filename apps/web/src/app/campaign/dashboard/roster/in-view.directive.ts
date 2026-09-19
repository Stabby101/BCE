import { Directive, ElementRef, OnDestroy, OnInit, inject, output } from '@angular/core';

@Directive({
    selector: '[bceInView]',
    standalone: true,
})
export class InViewDirective implements OnInit, OnDestroy {
    private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
    readonly inView = output<void>();
    private obs?: IntersectionObserver;

    ngOnInit(): void {
        if (typeof IntersectionObserver === 'undefined') {
            this.inView.emit(); // no IO (SSR/old) -> load eagerly
            return;
        }
        this.obs = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    this.inView.emit();
                    this.cleanup(); // fire once
                }
            },
            { rootMargin: '300px' },
        );
        this.obs.observe(this.el.nativeElement);
    }

    ngOnDestroy(): void {
        this.cleanup();
    }
    private cleanup(): void {
        this.obs?.disconnect();
        this.obs = undefined;
    }
}
