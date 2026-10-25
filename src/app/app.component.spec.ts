import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { AppComponent } from './app.component';
import { RemoteStore } from './remote/remote-store';
import { MemoryRemoteStore } from './remote/memory-remote-store';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([]), { provide: SwUpdate, useValue: { isEnabled: false } }, { provide: RemoteStore, useValue: new MemoryRemoteStore() }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
