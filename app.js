'use strict';

let token =
  localStorage.getItem('igc_token') ||
  sessionStorage.getItem('igc_token') ||
  '';

let role =
  localStorage.getItem('igc_role') ||
  sessionStorage.getItem('igc_role') ||
  '';

const API_BASE =
  'https://imperio-gamecloud-1.onrender.com/api/';
