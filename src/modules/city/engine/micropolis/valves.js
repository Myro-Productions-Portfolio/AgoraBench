/* micropolisJS. Adapted by Graeme McCutcheon from Micropolis.
 *
 * This code is released under the GNU GPL v3, with some additional terms.
 * Please see the files LICENSE and COPYING for details. Alternatively,
 * consult http://micropolisjs.graememcc.co.uk/LICENSE and
 * http://micropolisjs.graememcc.co.uk/COPYING
 *
 * The name/term "MICROPOLIS" is a registered trademark of Micropolis (https://www.micropolis.com) GmbH
 * (Micropolis Corporation, the "licensor") and is licensed here to the authors/publishers of the "Micropolis"
 * city simulation game and its source code (the project or "licensee(s)") as a courtesy of the owner.
 *
 */

import { EventEmitter } from './eventEmitter.js';
import { VALVES_UPDATED } from './messages.ts';
import { MiscUtils } from './miscUtils.js';

var Valves = EventEmitter(function () {
  this.resValve = 0;
  this.comValve = 0;
  this.indValve = 0;
  this.resCap = false;
  this.comCap = false;
  this.indCap = false;
  // PATCH(agorabench): injectable external demand offsets + the engine-integrated
  // base valves they bias. setValves runs the upstream integrator on the bases;
  // the visible valves become base + offset (see the tail of setValves below).
  this.resBase = 0;
  this.comBase = 0;
  this.indBase = 0;
  this.externalOffsetRes = 0;
  this.externalOffsetCom = 0;
  this.externalOffsetInd = 0;
});


var RES_VALVE_RANGE = 2000;
var COM_VALVE_RANGE = 1500;
var IND_VALVE_RANGE = 1500;


var taxTable = [
  200, 150, 120, 100, 80, 50, 30, 0, -10, -40, -100,
  -150, -200, -250, -300, -350, -400, -450, -500, -550, -600];
var extMarketParamTable = [1.2, 1.1, 0.98];

Valves.prototype.save = function(saveData) {
  saveData.resValve = this.resValve;
  saveData.comValve = this.comValve;
  saveData.indValve = this.indValve;
};


Valves.prototype.load = function(saveData) {
  this.resValve = saveData.resValve;
  this.comValve = saveData.comValve;
  this.indValve = saveData.indValve;

  this._emitEvent(VALVES_UPDATED);
};


Valves.prototype.setValves = function(gameLevel, census, budget) {
  var resPopDenom = 8;
  var birthRate = 0.02;
  var labourBaseMax = 1.3;
  var internalMarketDenom = 3.7;
  var projectedIndPopMin = 5.0;
  var resRatioDefault = 1.3;
  var resRatioMax = 2;
  var comRatioMax = 2;
  var indRatioMax = 2;
  var taxMax = 20;
  var taxTableScale = 600;
  var employment, labourBase;

  // Residential zones scale their population index when reporting it to the census
  var normalizedResPop = census.resPop / resPopDenom;
  census.totalPop = Math.round(normalizedResPop + census.comPop + census.indPop);

  // A lack of developed commercial and industrial zones means there are no employment opportunities, which constrain
  // growth. (This might hurt initially if, for example, the player lays out an initial grid, as the residential zones
  // will likely develop first, so the residential valve will immediately crater).
  if (census.resPop > 0)
    employment = (census.comHist10[1] + census.indHist10[1]) / normalizedResPop;
  else
    employment = 1;

  // Given the employment rate, calculate expected migration, add in births, and project the new population.
  var migration = normalizedResPop * (employment - 1);
  var births = normalizedResPop * birthRate;
  var projectedResPop = normalizedResPop + migration + births;

  // Examine how many zones require workers
  labourBase = census.comHist10[1] + census.indHist10[1];
  if (labourBase > 0.0)
    labourBase = census.resHist10[1] / labourBase;
  else
    labourBase = 1;
  labourBase = MiscUtils.clamp(labourBase, 0.0, labourBaseMax);

  // Project future industry and commercial needs, taking into account available labour, and competition from
  // other global cities
  var internalMarket = (normalizedResPop + census.comPop + census.indPop) / internalMarketDenom;
  var projectedComPop = internalMarket * labourBase;
  var projectedIndPop = census.indPop * labourBase * extMarketParamTable[gameLevel];
  projectedIndPop = Math.max(projectedIndPop, projectedIndPopMin);

  // Calculate the expected percentage changes in each population type
  var resRatio;
  if (normalizedResPop > 0)
    resRatio = projectedResPop / normalizedResPop;
  else
    resRatio = resRatioDefault;

  var comRatio;
  if (census.comPop > 0)
    comRatio = projectedComPop / census.comPop;
  else
    comRatio = projectedComPop;

  var indRatio;
  if (census.indPop > 0)
    indRatio = projectedIndPop / census.indPop;
  else
    indRatio = projectedIndPop;

  resRatio = Math.min(resRatio, resRatioMax);
  comRatio = Math.min(comRatio, comRatioMax);
  indRatio = Math.min(indRatio, indRatioMax);

  // Constrain growth according to the tax level.
  var z = Math.min((budget.cityTax + gameLevel), taxMax);
  resRatio = (resRatio - 1) * taxTableScale + taxTable[z];
  comRatio = (comRatio - 1) * taxTableScale + taxTable[z];
  indRatio = (indRatio - 1) * taxTableScale + taxTable[z];

  // PATCH(agorabench): the upstream integrator now runs on the base valves
  // (identical arithmetic); the visible valves add the injected external demand
  // offset, re-clamped to the native range, so a persistent offset biases demand
  // without compounding through the integrator on every recompute. Caps still
  // zero positive demand (stadium/port/airport prerequisites outrank external
  // demand). With all offsets 0 the visible valves equal the bases exactly —
  // byte-identical dynamics to upstream.
  this.resBase = MiscUtils.clamp(this.resBase + Math.round(resRatio), -RES_VALVE_RANGE, RES_VALVE_RANGE);
  this.comBase = MiscUtils.clamp(this.comBase + Math.round(comRatio), -COM_VALVE_RANGE, COM_VALVE_RANGE);
  this.indBase = MiscUtils.clamp(this.indBase + Math.round(indRatio), -IND_VALVE_RANGE, IND_VALVE_RANGE);

  if (this.resCap && this.resBase > 0)
    this.resBase = 0;

  if (this.comCap && this.comBase > 0)
      this.comBase = 0;

  if (this.indCap && this.indBase > 0)
      this.indBase = 0;

  this.resValve = MiscUtils.clamp(this.resBase + this.externalOffsetRes, -RES_VALVE_RANGE, RES_VALVE_RANGE);
  this.comValve = MiscUtils.clamp(this.comBase + this.externalOffsetCom, -COM_VALVE_RANGE, COM_VALVE_RANGE);
  this.indValve = MiscUtils.clamp(this.indBase + this.externalOffsetInd, -IND_VALVE_RANGE, IND_VALVE_RANGE);

  if (this.resCap && this.resValve > 0)
    this.resValve = 0;

  if (this.comCap && this.comValve > 0)
      this.comValve = 0;

  if (this.indCap && this.indValve > 0)
      this.indValve = 0;

  this._emitEvent(VALVES_UPDATED);
};


export { Valves };
