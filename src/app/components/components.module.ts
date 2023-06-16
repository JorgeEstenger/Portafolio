import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './navbar/navbar.component';
import { FooterComponent } from './footer/footer.component';
import { StartComponent } from './start/start.component';
import { SkillsComponent } from './skills/skills.component';
import { BriefcaseComponent } from './briefcase/briefcase.component';
import { ContactmeComponent } from './contactme/contactme.component';
import { AppRoutingModule } from '../app-routing.module';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';


import {MatCardModule} from '@angular/material/card';
import {MatButtonModule} from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';



@NgModule({
  declarations: [
    NavbarComponent,
    FooterComponent,
    StartComponent,
    SkillsComponent,
    BriefcaseComponent,
    ContactmeComponent
  ],
  exports:[
    NavbarComponent,
    FooterComponent,
    StartComponent,
    SkillsComponent,
    BriefcaseComponent,
    ContactmeComponent

  ],
  imports: [
    CommonModule,
    AppRoutingModule,
    BrowserAnimationsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatToolbarModule,
  ]
})
export class ComponentsModule { }
