import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BriefcaseComponent } from './briefcase.component';

describe('BriefcaseComponent', () => {
  let component: BriefcaseComponent;
  let fixture: ComponentFixture<BriefcaseComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [BriefcaseComponent]
    });
    fixture = TestBed.createComponent(BriefcaseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
