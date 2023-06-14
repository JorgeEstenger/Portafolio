import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StartComponent } from './components/start/start.component';
import { SkillsComponent } from './components/skills/skills.component';
import { ContactmeComponent } from './components/contactme/contactme.component';
import { BriefcaseComponent } from './components/briefcase/briefcase.component';

const routes: Routes = [
  {path:'start', component: StartComponent},
  {path:'skills', component: SkillsComponent},
  {path: 'contactme', component: ContactmeComponent},
  {path: 'briefcase', component: BriefcaseComponent},
  {path: '**', pathMatch: 'full', redirectTo:'start' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
