'use strict';

let token =
  localStorage.getItem('igc_token') ||
  sessionStorage.getItem('igc_token') ||
  '';

let role = '';

const API_BASE =
  'https://imperio-gamecloud-1.onrender.com/api/';

const el = id => document.getElementById(id);

function show(page) {
  document
    .querySelectorAll('.page')
    .forEach(p =>
      p.classList.toggle('active', p.id === page)
    );

  message('');
}

function message(text, error = false) {
  const p = el('message');

  if (!p) return;

  p.textContent = text;
  p.className = error ? 'error' : 'success';
}

async function api(url, method = 'GET', data) {
  const response = await fetch(API_BASE + url, {
    method,

    headers: {
      'Content-Type': 'application/json',

      ...(token
        ? {
            Authorization:
              'Bearer ' + token
          }
        : {})
    },

    ...(data
      ? {
          body: JSON.stringify(data)
        }
      : {})
  });

  let body;

  try {
    body = await response.json();
  } catch {
   
