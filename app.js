miguelldejesus395-tech / Imperio-gamecloud

Q

52

42%

Code Issues 11 Pull requests

Agents

Actions

Projects

Security and quality

Insights M

main

imperio-gamecloud / app.js

miguelldejesus395-tech Fix formatting and add role assignment in saveSession

Code Blame 864 lines (696 loc) 15.5 KB

'use strict';

let token

localStorage.getItem(ige token") ||

sessionStorage.getItem('igc_token') ||

10

13

let role

LocalStorage.getItem('igc_role') ||

sessionStorage.getItem('igc_role') ||

const API BASE

'https://imperio-gamecloud-1.onrender.com/api/';

function el(id) {

return document.getElementById(id):

19

20

function show(page) {

21

document

22

.querySelectorAll('.page')

.forEach(function (p) {

24

p.classList.toggle('active', p.id page);

25

));

20

27

message("");

20

30 function message(text, error) {

31

const pel('message');

32

if (1p) return;

34

35

p.textContent text || '';

36 p.classNane error ? error': 'success';

37

38

39 function fail(error) {

40

message(

error && error.message

42

? error.message

: 'Ocorreu um erro.',

True

45

);

48

async function api(url, method 'GET', data null) {

const options = {

method: method,

50

51

headers: (

52

};

54

if (data = null) {

55

options.headers['Content-Type"]=

56

"application/json';

57

58

options.body JSON.stringify(data);

59

}

61

if (token) (
