/**
 * 짧은 시간에 몰려오는 "다시 스캔해라" 요청을 하나로 합치고, 같은 작업이 겹쳐서 여러 개 동시에
 * 돌지 않게 하는 작은 실행기.
 *
 * 빌드나 파일 동기화가 .js/.tld 파일을 수백~수천 개 만들면 파일 변경 알림이 연달아 오는데,
 * 알림마다 워크스페이스 전체 스캔을 새로 시작하면 스캔이 겹쳐 쌓여서 CPU/디스크를 계속 잡아먹는다.
 *
 * - 마지막 요청 후 delayMs 동안 조용해지면 한 번만 실행한다(debounce).
 * - 요청이 끊기지 않아도 처음 요청 후 maxWaitMs 가 지나면 실행한다(계속 밀리는 것 방지).
 * - 실행 중에 새 요청이 오면 겹쳐 실행하지 않고, 끝난 뒤 한 번 더 실행한다.
 */
export class CoalescingRunner {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;
  private firstRequestAt = 0;
  private disposed = false;

  constructor(
    private readonly task: () => Promise<void>,
    private readonly delayMs: number = 500,
    private readonly onError: (err: unknown) => void = () => {},
    private readonly maxWaitMs: number = 5000
  ) {}

  trigger(): void {
    if (this.disposed) return;
    if (this.running) {
      this.again = true;
      return;
    }
    const now = Date.now();
    if (this.timer) {
      clearTimeout(this.timer);
    } else {
      this.firstRequestAt = now;
    }
    const wait = Math.max(0, Math.min(this.delayMs, this.firstRequestAt + this.maxWaitMs - now));
    this.timer = setTimeout(() => void this.run(), wait);
  }

  private async run(): Promise<void> {
    this.timer = undefined;
    this.running = true;
    this.again = false;
    try {
      await this.task();
    } catch (err) {
      this.onError(err);
    } finally {
      this.running = false;
      if (this.again && !this.disposed) {
        this.again = false;
        this.trigger();
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
